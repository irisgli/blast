import type { EvidenceRecord, IngestAdapter, IngestContext, Result } from "@blast/core";
import { fail } from "@blast/core";
import { infracostAdapter } from "./infracost.js";
import { lighthouseAdapter } from "./lighthouse.js";

/**
 * Every tool blast can read the output of.
 *
 * A registry rather than a switch in the API handler, for the same reason the sources are
 * a registry: adding an integration should be one file and one line, and the HTTP surface,
 * the CLI and the agent should all pick it up without being told separately.
 */
export const INGEST_ADAPTERS: readonly IngestAdapter[] = [infracostAdapter, lighthouseAdapter];

export function ingestAdapterById(id: string): IngestAdapter | undefined {
  return INGEST_ADAPTERS.find((adapter) => adapter.id === id);
}

export function describeIngestAdapters() {
  return INGEST_ADAPTERS.map((adapter) => ({
    ...adapter.describe(),
    provider: adapter.provider,
  }));
}

/**
 * Parses a payload with the named adapter.
 *
 * An unknown id fails as `unavailable` rather than `no-data`, and the distinction is the
 * whole point. Callers treat `no-data` as a clean run with nothing to say — which is what an
 * Infracost run over an unpriced plan is — and treat `unavailable` as a broken integration
 * that stops the request. A pipeline that typed `infracosts` has a broken integration, and
 * it should hear about it on the first run rather than discover months later that its cost
 * gate has been contributing nothing.
 */
export function ingestWith(
  id: string,
  payload: unknown,
  context: IngestContext,
): Result<EvidenceRecord[]> {
  const adapter = ingestAdapterById(id);
  if (adapter === undefined) {
    const known = INGEST_ADAPTERS.map((entry) => entry.id).join(", ");
    return fail("unavailable", `No ingest adapter named ${id}. Registered: ${known}.`);
  }
  return adapter.ingest(payload, context);
}

export * from "./infracost.js";
export * from "./lighthouse.js";
