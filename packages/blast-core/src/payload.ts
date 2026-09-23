import type { Dependency } from "./schema.js";

/**
 * Attributes a measured client payload delta to the dependencies a change added.
 *
 * A payload number says there is a problem; attribution says whether it is a fixable
 * one. One dependency accounting for most of an increase is a conversation with an
 * obvious next step. The same bytes spread across application code is the feature
 * itself, and saying so is more useful than implying there is something to swap out.
 */

export interface PayloadShare {
  name: string;
  version: string;
  bytes: number;
  /** Share of the total delta, 0 to 1. */
  share: number;
}

export interface PayloadAttribution {
  totalBytes: number;
  attributed: PayloadShare[];
  /** Dependencies the build did not size. Their bytes land in the remainder. */
  unmeasured: { name: string; version: string }[];
  remainderBytes: number;
  remainderShare: number;
  /**
   * True when dependencies account for more than the whole delta, which means code
   * elsewhere shrank or the figures came from different builds. The attribution should
   * not be reported when this is set.
   */
  overAttributed: boolean;
}

export function attributePayload(input: {
  clientBytesDelta: number;
  dependenciesAdded: readonly Dependency[];
}): PayloadAttribution {
  const total = input.clientBytesDelta;
  const measured = input.dependenciesAdded.filter(
    (dependency): dependency is Dependency & { bytes: number } => dependency.bytes !== null,
  );
  const attributedBytes = measured.reduce((sum, dependency) => sum + dependency.bytes, 0);
  const remainderBytes = total - attributedBytes;

  return {
    totalBytes: total,
    attributed: measured
      .map((dependency) => ({
        name: dependency.name,
        version: dependency.version,
        bytes: dependency.bytes,
        share: total === 0 ? 0 : dependency.bytes / total,
      }))
      .sort((left, right) => right.bytes - left.bytes),
    unmeasured: input.dependenciesAdded
      .filter((dependency) => dependency.bytes === null)
      .map((dependency) => ({ name: dependency.name, version: dependency.version })),
    remainderBytes,
    remainderShare: total === 0 ? 0 : remainderBytes / total,
    overAttributed: remainderBytes < 0,
  };
}
