import { groundOf } from "../rock/ground";
import type { GroundQuery } from "../rock/groundQuery";
import { rockCatalogue } from "../rock/rockCatalogue";
import type { RegionalState } from "./state";

/** The reached substrate answers first: a loose cap hides the intact rock beneath it. */
export const cuttingResistance: GroundQuery<number | undefined> = {
  start: undefined,
  loose: (_, { strength }, { fracture, ward }) => resistance(strength, fracture, ward),
  rock: (cover, { strength }, { fracture, ward }) => cover ?? resistance(strength, fracture, ward),
  acrossFacets: (land, cut, share) => (land ?? 1) * (1 - share) + (cut ?? 1) * share,
};

/** Positive resistance follows retained material and current fracture/protection, without a cap. */
function resistance(strength: number, fracture: number, ward: number) {
  return (
    (strength / rockCatalogue.strata.resistance) ** 0.9 *
    Math.exp(-0.5 * fracture) *
    (1 + 0.5 * ward)
  );
}

/** Network and detail calculations read the same actual material the later wear will reach. */
export const materialResistance = (state: RegionalState, cell: number) =>
  groundOf(state.physical.map).fold(cell, cuttingResistance) ?? 1;
