import { MapScale } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { crustPerRock, rockLoadResponsePerMille } from "../world/math";
import { recordFlow, type FlowCause, type Pool } from "../coupling/flows";
import { adjustCrustColumn } from "./crustTransport";
import { facetShare, type GroundFacet } from "./groundShares";
import { groundStorage } from "./groundStorage";
import { loadOf } from "./groundLoad";
import type { MaterialLayer } from "./rockColumn";
import type { MaterialReceiver } from "./groundMaterial";
import { releasedMaterial } from "./groundCargoIdentity";

const volumeOf = (map: PhysicalField, cell: number, depth: number) =>
  MapScale.metres(depth, "native") * map.mesh.area(cell);

/** Finite crust beneath the ground. */
export const availableCrust = (map: PhysicalField, cell: number) =>
  Math.max(0, map.CrustThickness.get(cell));

/** Rock removal accounts for surface load before drawing from the buoyant crust column. */
export function lowerRock(map: PhysicalField, i: number, amount: number) {
  const pile = Math.max(0, map.SurfaceRockLoad.get(i)),
    below = Math.max(0, amount - pile),
    perRock = crustPerRock(map.CrustContinentalFraction.get(i) / 1000),
    crust = Math.min(availableCrust(map, i), below * perRock),
    rootRock = crust / perRock;
  groundStorage(map).BedrockElevation.add(i, -amount);
  groundStorage(map).SurfaceRockLoad.add(
    i,
    -(amount - below) - rootRock / (rockLoadResponsePerMille / 1000)
  );
  if (crust > 0) adjustCrustColumn(map, i, map.CrustThickness.get(i) - crust);
}

/** Placement, soil and load settle identically for surface stripping and selective extraction. */
export function settleWithdrawal(
  map: PhysicalField,
  i: number,
  facet: GroundFacet,
  loose: number,
  rock: number,
  soil: number,
  cause: FlowCause,
  to: Pool
) {
  const share = facetShare(map, i, facet);
  if (rock > 0) {
    lowerRock(map, i, rock * share);
    groundStorage(map).GroundCutDepth.add(i, facet === "cut" ? rock : -rock);
  }
  map.SoilDepth.set(i, Math.max(0, map.SoilDepth.get(i) - MapScale.metres(soil * share, "native")));
  recordFlow(map, cause, "loose", to, volumeOf(map, i, loose * share));
  recordFlow(map, cause, "rock", to, volumeOf(map, i, rock * share));
}

/** Owner receipts are cell-weighted; the default material load uses volume. */
export function withdrawalReceiver(
  map: PhysicalField,
  cell: number,
  share: number,
  to: Pool,
  receive?: MaterialReceiver,
  retainCustody = false
) {
  return (material: MaterialLayer) => {
    const parcel = {
      ...(retainCustody ? material : releasedMaterial(map, material)),
      depth: material.depth * share,
    };
    if (receive) receive(parcel);
    else if (to === "load")
      loadOf(map).add(cell, { ...parcel, depth: volumeOf(map, cell, parcel.depth) });
  };
}
