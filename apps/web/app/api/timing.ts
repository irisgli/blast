import type { DecisionTiming } from "@blast/brief";
import type { SourceStatus } from "@blast/core";

/**
 * `Server-Timing`, for the number that has to move.
 *
 * The rendered markdown carries no timing, because a pull request comment has to be
 * byte-identical across re-runs and a wall-clock reading would edit it every time. A
 * response header is where a number allowed to vary belongs, in the one format a browser's
 * devtools and a proxy already parse. One entry per stage of the decision when the caller
 * has them, then one per source with its state, so the first question about a slow or empty
 * decision — which stage, which source — is answered on the response line.
 */
export function serverTiming(
  sources: readonly SourceStatus[],
  timing?: DecisionTiming,
): string {
  const entries: string[] = [];
  if (timing !== undefined) {
    entries.push(`total;dur=${timing.totalMs}`);
    if (timing.collectMs !== null) entries.push(`collect;dur=${timing.collectMs}`);
    entries.push(`assess;dur=${timing.assessMs}`, `render;dur=${timing.renderMs}`);
  }
  for (const source of sources) {
    const duration = source.durationMs === null ? 0 : Math.round(source.durationMs * 100) / 100;
    entries.push(`${source.id.replace(/[^\w-]/g, "_")};desc="${source.state}";dur=${duration}`);
  }
  return entries.join(", ");
}
