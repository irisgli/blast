import { FIXTURE_FILES } from "@blast-fixtures/storefront";
import type { ChangeProfile, Result } from "@blast/core";
import { changeProfileSchema } from "@blast/core";
import { loadFixture } from "./fixture-store.js";

/**
 * The fixture stand-in for `read_change`.
 *
 * Parsing a real pull request means shelling out to git and gh; this returns the same
 * shape from checked-in data so the rest of the pipeline can be exercised, and tested,
 * without a repository or a network.
 *
 * It validates against `changeProfileSchema` from `@blast/core` — the same schema the
 * agent's tools validate their input with. A fixture that drifted from the shape the
 * tools accept would pass here and fail there, which is the one bug a checked-in
 * fixture exists to make impossible.
 */
export function loadFixtureChangeProfile(): Result<ChangeProfile> {
  return loadFixture(FIXTURE_FILES.change, changeProfileSchema);
}
