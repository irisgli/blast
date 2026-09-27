#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { describeIngestAdapters, ingestWith, loadFixtureChangeProfile } from "@blast/adapters";
import { FileDecisionStore, decisionLogPath, loadPolicy, produceBrief } from "@blast/brief";
import type { ChangeProfile, EvidenceRecord, Policy, Verdict } from "@blast/core";
import {
  EXIT_BLOCKED,
  EXIT_OK,
  EXIT_UNAVAILABLE,
  evidenceRecordSchema,
  summarize,
} from "@blast/core";
import { readChange } from "./change.js";
import { postBrief } from "./comment.js";

/**
 * `blast` — the decision, without an agent turn.
 *
 * Everything that decides is deterministic code: the evidence, the budgets, the rules, the
 * verdict, and the remediations. None of it needs a model, which means none of it needs to
 * wait for someone to mention `@blast` on a thread. This is the command a pipeline runs on
 * every pull request, and it is what turns the tool from something you can ask into a check
 * that has already run by the time you look.
 *
 * Three commands, one engine underneath all of them:
 *
 *   brief    the markdown a human reads, and optionally posts to the thread
 *   decide   the same decision as JSON, for a job that is going to act on it
 *   audit    what the log says across every decision recorded so far
 *
 * `decide` is the one that makes this integrable. It accepts evidence the pipeline already
 * has — an Infracost breakdown, a Lighthouse result, records a company's own service
 * measured — normalizes it through the ingest adapters, and prints a decision object with
 * every rule that fired and the evidence that fired it. A platform team wiring blast in
 * does not have to parse a comment to find out what happened.
 *
 * Exit codes are part of the contract, not a detail:
 *   0  a decision was produced, and it cleared whatever `--fail-on` allows
 *   1  the verdict did not clear `--fail-on`
 *   2  no decision could be produced at all
 *
 * The distinction matters to the job running this. A held change and a broken tool both
 * stop a pipeline, and treating them the same teaches everyone to ignore the failure.
 */

const USAGE = `blast — a pre-ship impact decision for a change

usage
  blast brief  <pr-number|branch|fixture> [options]
  blast decide <pr-number|branch|fixture> [options]
  blast audit  [options]

brief and decide
  --intent <text>       what the change is for, in user-facing terms (required)
  --fail-on <verdict>   exit 1 when the verdict is this or worse: hold | ship-with-caveats
  --policy <path>       a blast.json to apply, instead of searching upwards
  --repo <owner/name>   the repository, recorded on the decision
  --org <name>          the organization, recorded on the decision
  --evidence <path>     JSON file of evidence records to contribute, or - for stdin
  --ingest <id>=<path>  raw output from a tool to normalize: infracost=cost.json
  --as-of <YYYY-MM-DD>  the day exception expiry is judged against (default: today)
  --log <path>          where to append the decision (default: .blast/decisions.jsonl)
  --no-log              do not record this decision

brief only
  --post                post the brief to the pull request, or update the one there
  --format <fmt>        markdown (default) | json

audit
  --repo <owner/name>   only decisions about this repository
  --rule <rule-id>      only decisions where this rule fired or was waived
  --since <iso>         only decisions made at or after this instant
  --summary             the aggregate rather than the rows (default)
  --json                machine-readable output
  --log <path>          which log to read

exit codes
  0  decision produced and the verdict cleared --fail-on
  1  the verdict did not clear --fail-on
  2  the decision could not be produced
`;

/** Worst first, so `--fail-on ship-with-caveats` also fails a hold. */
const SEVERITY: Record<Verdict, number> = {
  hold: 2,
  "ship-with-caveats": 1,
  ship: 0,
};

type Command = "brief" | "decide" | "audit";

interface Options {
  command: Command;
  ref: string;
  intent: string;
  post: boolean;
  failOn: Verdict | null;
  format: "markdown" | "json";
  policy: string | null;
  repo: string | null;
  org: string | null;
  evidence: string | null;
  ingest: { adapter: string; path: string }[];
  asOf: string | null;
  log: string | null;
  record: boolean;
  rule: string | null;
  since: string | null;
  json: boolean;
}

function defaults(command: Command, ref: string): Options {
  return {
    command,
    ref,
    intent: "",
    post: false,
    failOn: null,
    format: "markdown",
    policy: null,
    repo: null,
    org: null,
    evidence: null,
    ingest: [],
    asOf: null,
    log: null,
    record: true,
    rule: null,
    since: null,
    json: false,
  };
}

function parseArgs(argv: readonly string[]): Options | { error: string } {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") return { error: USAGE };
  if (command !== "brief" && command !== "decide" && command !== "audit") {
    return { error: `Unknown command ${command}.\n\n${USAGE}` };
  }

  let ref = "";
  let start = 0;

  if (command !== "audit") {
    const candidate = rest[0];
    if (candidate === undefined || candidate.startsWith("-")) {
      return { error: `A pull request number, a branch, or 'fixture' is required.\n\n${USAGE}` };
    }
    ref = candidate;
    start = 1;
  }

  const options = defaults(command, ref);

  for (let index = start; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];

    switch (flag) {
      case "--post":
        options.post = true;
        break;
      case "--no-log":
        options.record = false;
        break;
      case "--summary":
        break;
      case "--json":
        options.json = true;
        break;
      case "--intent":
        if (value === undefined) return { error: "--intent needs a value." };
        options.intent = value;
        index += 1;
        break;
      case "--fail-on": {
        if (value === undefined) return { error: "--fail-on needs a value." };
        if (value !== "hold" && value !== "ship-with-caveats") {
          return { error: `--fail-on takes hold or ship-with-caveats, not ${value}.` };
        }
        options.failOn = value;
        index += 1;
        break;
      }
      case "--format":
        if (value !== "markdown" && value !== "json") {
          return { error: "--format takes markdown or json." };
        }
        options.format = value;
        index += 1;
        break;
      case "--policy":
        if (value === undefined) return { error: "--policy needs a path." };
        options.policy = value;
        index += 1;
        break;
      case "--repo":
        if (value === undefined) return { error: "--repo needs an owner/name." };
        options.repo = value;
        index += 1;
        break;
      case "--org":
        if (value === undefined) return { error: "--org needs a name." };
        options.org = value;
        index += 1;
        break;
      case "--evidence":
        if (value === undefined) return { error: "--evidence needs a path, or - for stdin." };
        options.evidence = value;
        index += 1;
        break;
      case "--ingest": {
        if (value === undefined) {
          return { error: "--ingest takes <adapter>=<path>, for example infracost=cost.json." };
        }
        const split = value.indexOf("=");
        if (split <= 0 || split === value.length - 1) {
          const known = describeIngestAdapters()
            .map((entry) => entry.id)
            .join(", ");
          return {
            error: `--ingest takes <adapter>=<path>. Registered adapters: ${known}.`,
          };
        }
        options.ingest.push({
          adapter: value.slice(0, split),
          path: value.slice(split + 1),
        });
        index += 1;
        break;
      }
      case "--as-of":
        if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          return { error: "--as-of takes a date, as YYYY-MM-DD." };
        }
        options.asOf = value;
        index += 1;
        break;
      case "--log":
        if (value === undefined) return { error: "--log needs a path." };
        options.log = value;
        index += 1;
        break;
      case "--rule":
        if (value === undefined) return { error: "--rule needs a rule id." };
        options.rule = value;
        index += 1;
        break;
      case "--since":
        if (value === undefined) return { error: "--since needs an ISO instant." };
        options.since = value;
        index += 1;
        break;
      case "--help":
      case "-h":
        return { error: USAGE };
      default:
        return { error: `Unknown option ${flag}.\n\n${USAGE}` };
    }
  }

  if (options.command !== "audit" && options.intent === "") {
    /**
     * Refused rather than defaulted. A diff says what moved and never what it is for, and
     * the measurability dimension is the one that most needs the difference — a brief
     * written against an invented intent reads exactly like one written against a real one.
     */
    return { error: "--intent is required: one line on what the change is for.\n\n" + USAGE };
  }

  return options;
}

async function readInput(path: string): Promise<string> {
  if (path !== "-") return readFile(path, "utf8");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Evidence the pipeline brought, validated before it can influence anything.
 *
 * A record that fails the schema fails the run rather than being dropped. A cost gate that
 * silently contributed nothing because a field was misspelled is the exact failure this is
 * supposed to prevent, and it looks identical to a clean run from the outside.
 */
async function contributedEvidence(
  options: Options,
  surfaces: readonly string[],
): Promise<{ records: EvidenceRecord[]; notes: string[] } | { error: string }> {
  const records: EvidenceRecord[] = [];
  const notes: string[] = [];

  if (options.evidence !== null) {
    let document: unknown;
    try {
      document = JSON.parse(await readInput(options.evidence));
    } catch (error) {
      return {
        error: `--evidence could not be read: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const list = Array.isArray(document) ? document : [document];
    for (const [index, entry] of list.entries()) {
      const parsed = evidenceRecordSchema.safeParse(entry);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return {
          error: `--evidence record ${index} is invalid: ${issue?.message ?? "unknown"} at ${issue?.path.join(".") || "the record"}`,
        };
      }
      records.push(parsed.data);
    }
    notes.push(`Contributed ${records.length} evidence record${records.length === 1 ? "" : "s"}.`);
  }

  for (const entry of options.ingest) {
    let payload: unknown;
    try {
      payload = JSON.parse(await readInput(entry.path));
    } catch (error) {
      return {
        error: `--ingest ${entry.adapter}: ${entry.path} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const result = ingestWith(entry.adapter, payload, { surfaces });
    if (!result.ok) {
      // A clean run with nothing to say is a note. A broken payload is a failure.
      if (result.reason === "no-data") {
        notes.push(`${entry.adapter}: ${result.detail}`);
        continue;
      }
      return { error: `--ingest ${entry.adapter}: ${result.detail}` };
    }

    records.push(...result.value);
    notes.push(
      `${entry.adapter}: ${result.value.length} record${result.value.length === 1 ? "" : "s"} from ${entry.path}.`,
    );
  }

  return { records, notes };
}

async function runAudit(options: Options): Promise<number> {
  const store = new FileDecisionStore({ path: decisionLogPath(options.log ?? undefined) });

  let records;
  try {
    records = await store.list({
      ...(options.repo === null ? {} : { repo: options.repo }),
      ...(options.rule === null ? {} : { ruleId: options.rule }),
      ...(options.since === null ? {} : { since: options.since }),
      limit: 1000,
    });
  } catch (error) {
    process.stderr.write(
      `blast: the decision log could not be read: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return EXIT_UNAVAILABLE;
  }

  const summary = summarize(records);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return EXIT_OK;
  }

  if (summary.decisions === 0) {
    process.stdout.write("No decisions recorded yet.\n");
    return EXIT_OK;
  }

  const lines: string[] = [
    `${summary.decisions} decision${summary.decisions === 1 ? "" : "s"}: ${summary.held} held, ${summary.blocked} blocked by a gate`,
    `verdicts: ${summary.byVerdict.ship} ship, ${summary.byVerdict["ship-with-caveats"]} with caveats, ${summary.byVerdict.hold} hold`,
    /**
     * Named as modeled, every time it is printed. It is the sum of an estimate over changes
     * blast said no to, which is worth knowing and is not money in the bank.
     */
    `monthly spend on held changes: $${summary.heldMonthlyCostUsd.toFixed(2)} (modeled, not billed)`,
  ];

  /**
   * A gate installed and not enabled is the most common way this stops working, and it is
   * invisible unless something says it out loud.
   */
  if (summary.held > 0 && summary.blocked === 0) {
    lines.push(
      `note: ${summary.held} change${summary.held === 1 ? " was" : "s were"} held and none were blocked. No caller is passing --fail-on.`,
    );
  }

  if (summary.rules.length > 0) {
    lines.push("", "rules");
    for (const rule of summary.rules) {
      const rate = rule.waiveRate === null ? "—" : `${Math.round(rule.waiveRate * 100)}%`;
      lines.push(
        `  ${rule.ruleId}  fired ${rule.fired}  waived ${rule.waived}  silent ${rule.observed}  waive rate ${rate}${rule.owner === null ? "" : `  owner ${rule.owner}`}`,
      );
    }
  }

  if (summary.lapsedExceptions.length > 0) {
    lines.push("", "lapsed exceptions still being relied on");
    for (const entry of summary.lapsedExceptions) {
      lines.push(`  ${entry.ruleId}  ${entry.count}`);
    }
  }

  process.stdout.write(`${lines.join("\n")}\n`);
  return EXIT_OK;
}

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}\n`);
    return parsed.error === USAGE ? EXIT_OK : EXIT_UNAVAILABLE;
  }

  if (parsed.command === "audit") return runAudit(parsed);

  let profile: ChangeProfile;
  let notes: string[];

  if (parsed.ref === "fixture") {
    const fixture = loadFixtureChangeProfile();
    if (!fixture.ok) {
      process.stderr.write(`blast: ${fixture.detail}\n`);
      return EXIT_UNAVAILABLE;
    }
    profile = fixture.value;
    notes = ["Read from the checked-in sample pull request."];
  } else {
    const read = await readChange({ ref: parsed.ref, intent: parsed.intent });
    if (!read.ok) {
      process.stderr.write(`blast: ${read.detail}\n`);
      return EXIT_UNAVAILABLE;
    }
    profile = read.value.profile;
    notes = read.value.notes;
  }

  /**
   * A named policy file that cannot be read stops the run here rather than falling back. A
   * pipeline that asked for its own budgets and silently got the defaults would gate merges
   * on ceilings nobody chose, and every run would look ordinary.
   */
  let policy: Policy | undefined;
  if (parsed.policy !== null) {
    const loaded = await loadPolicy({ path: parsed.policy });
    if (!loaded.ok) {
      process.stderr.write(`blast: ${loaded.detail}\n`);
      return EXIT_UNAVAILABLE;
    }
    policy = loaded.value;
  }

  const surfaces = profile.surfaces.map((surface) => surface.id);
  const contributed = await contributedEvidence(parsed, surfaces);
  if ("error" in contributed) {
    process.stderr.write(`blast: ${contributed.error}\n`);
    return EXIT_UNAVAILABLE;
  }
  notes.push(...contributed.notes);

  const produced = await produceBrief({
    profile: { ...profile, intent: parsed.intent },
    /**
     * No model ran, so nothing here writes a narrative. Saying that plainly is better than a
     * generated sentence that reads like judgement and is not: the dimension rationales
     * below it are the rules' own words, and they are the honest version.
     */
    headline:
      "Produced without a model, so this line is not an assessment. The verdict, every number, and the remediations below are code over the evidence; the dimension rationales say which rule decided what.",
    evidence: contributed.records,
    gate: parsed.failOn,
    repo: parsed.repo,
    org: parsed.org,
    ...(policy === undefined ? {} : { policy }),
    ...(parsed.asOf === null ? {} : { asOf: parsed.asOf }),
  });

  if (!produced.ok) {
    process.stderr.write(`blast: ${produced.detail}\n`);
    return EXIT_UNAVAILABLE;
  }

  const { brief, markdown, decision } = produced.value;

  if (parsed.command === "decide") {
    process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  } else if (parsed.format === "json") {
    process.stdout.write(`${JSON.stringify({ brief, markdown, decision, notes }, null, 2)}\n`);
  } else {
    process.stdout.write(`${markdown}\n`);
    // Notes go to stderr so `blast brief … > brief.md` is the brief and nothing else.
    for (const note of notes) process.stderr.write(`note: ${note}\n`);
  }

  /**
   * Recorded before the gate is applied, and before posting. The log is about what was
   * decided, not about what the pipeline then did with it — a blocked change that nobody
   * ever saw is exactly the kind of thing an audit needs to contain.
   */
  if (parsed.record) {
    try {
      await new FileDecisionStore({ path: decisionLogPath(parsed.log ?? undefined) }).append({
        decision,
        recordedAt: new Date().toISOString(),
        actor: parsed.repo === null ? "cli" : `cli:${parsed.repo}`,
      });
    } catch (error) {
      // A log that cannot be written must not discard a decision that was already made.
      process.stderr.write(
        `blast: the decision was produced but not recorded. ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  if (parsed.post) {
    if (brief.ref.kind !== "pr") {
      process.stderr.write("blast: --post needs a pull request number, not a branch.\n");
      return EXIT_UNAVAILABLE;
    }
    const outcome = await postBrief({ pullRequest: brief.ref.id, markdown });
    if (!outcome.ok) {
      process.stderr.write(
        `blast: the brief was produced but not posted. ${outcome.failure.detail}\n`,
      );
      return EXIT_UNAVAILABLE;
    }
    process.stderr.write(`blast: ${outcome.action} (${brief.digest}).\n`);
  }

  if (parsed.failOn !== null && SEVERITY[brief.verdict] >= SEVERITY[parsed.failOn]) {
    process.stderr.write(
      `blast: verdict is ${brief.verdict}, which does not clear --fail-on ${parsed.failOn}.\n`,
    );
    for (const evaluation of decision.triggered) {
      process.stderr.write(`blast:   ${evaluation.ruleId}: ${evaluation.message}\n`);
    }
    return EXIT_BLOCKED;
  }

  return EXIT_OK;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // Nothing should reach here; if it does, say so rather than exiting 1 and looking like
    // a held verdict.
    process.stderr.write(`blast: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = EXIT_UNAVAILABLE;
  });
