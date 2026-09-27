import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { describeIngestAdapters, ingestWith } from "@blast/adapters";
import type { EvidenceRecord } from "@blast/core";

/**
 * Reading a vendor's output off disk, for the tools that need it.
 *
 * The model names a *file*, never a number. That distinction is the whole reason this is
 * shaped the way it is: `render_brief` already refuses to accept findings from the model and
 * re-derives them instead, because the field a model is most tempted to adjust is the one the
 * brief rests on. A tool that took an Infracost payload as a tool argument would hand that
 * temptation straight back — the model would be authoring the cost of the change.
 *
 * So the argument is a path, the parse happens here, and the numbers come from bytes the
 * pipeline wrote.
 */

export interface EvidenceSource {
  adapter: string;
  path: string;
}

export interface LoadedEvidence {
  records: EvidenceRecord[];
  notes: string[];
}

/**
 * Refuses a path outside the working tree.
 *
 * `../../../.ssh/config` is not going to parse as an Infracost breakdown, so this is not
 * guarding against a leak so much as against a confusing error and a tool that will read
 * anything it is pointed at. The refusal names what it wanted, because a model that gets a
 * flat denial will try three more paths.
 */
export function resolveWithinWorkspace(path: string, cwd = process.cwd()): string | null {
  const absolute = isAbsolute(path) ? path : resolve(cwd, path);
  const within = relative(cwd, absolute);
  if (within === "" || within.startsWith("..") || isAbsolute(within)) return null;
  return absolute;
}

export async function loadEvidence(
  sources: readonly EvidenceSource[],
  surfaces: readonly string[],
  cwd = process.cwd(),
): Promise<LoadedEvidence | { error: string }> {
  const records: EvidenceRecord[] = [];
  const notes: string[] = [];
  const known = describeIngestAdapters().map((entry) => entry.id);

  for (const source of sources) {
    if (!known.includes(source.adapter)) {
      return {
        error: `No ingest adapter named ${source.adapter}. Registered: ${known.join(", ")}.`,
      };
    }

    const path = resolveWithinWorkspace(source.path, cwd);
    if (path === null) {
      return {
        error: `${source.path} is outside the repository. Evidence files are read from the checkout the change is in.`,
      };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      return {
        error: `${source.path} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}.`,
      };
    }

    const result = ingestWith(source.adapter, payload, { surfaces });
    if (!result.ok) {
      /**
       * A clean run with nothing to say is a note the agent can mention. Anything else is a
       * broken integration and stops the tool: a brief produced while a cost source silently
       * contributed nothing reads exactly like one where it contributed.
       */
      if (result.reason === "no-data") {
        notes.push(`${source.adapter}: ${result.detail}`);
        continue;
      }
      return { error: `${source.adapter}: ${result.detail}` };
    }

    records.push(...result.value);
    notes.push(
      `${source.adapter}: ${result.value.length} record${result.value.length === 1 ? "" : "s"} from ${source.path}.`,
    );
  }

  return { records, notes };
}
