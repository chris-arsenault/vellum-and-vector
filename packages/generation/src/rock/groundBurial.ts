import type { PhysicalField } from "../world/field";
import { recordFlow, type FlowCause } from "../coupling/flows";
import { layDownPackage, type MaterialLayer } from "./rockColumn";
import { rockCatalogue } from "./rockCatalogue";
import { burialResponse } from "./modes";
import { withdrawBuried } from "./groundMaterial";
import { coverColumn, columnThickness, facetShare, projectGround } from "./groundShares";
import { groundStorage } from "./groundStorage";

/** Loose cover buried deep enough becomes rock where it lies, and the ground stays where it is. */
export function lithify(map: PhysicalField, i: number, amount: number, cause: FlowCause) {
  return consolidateCover(
    map,
    i,
    () => amount,
    cause,
    (layer) => burialResponse(layer, map.CompletedEpochCount)
  );
}
/** Burial eligibility is local depth beneath each occupied surface, never mean cell cover. */
export function lithifyBuried(
  map: PhysicalField,
  i: number,
  threshold: number,
  hardened: number,
  cause: FlowCause
) {
  return consolidateCover(
    map,
    i,
    (cover) => Math.max(0, cover - threshold) * hardened,
    cause,
    (layer) => burialResponse(layer, map.CompletedEpochCount)
  );
}
/** Overburden entombs cover as a weak bed; it does not instantly restore intact clast strength. */
export function buryCover(map: PhysicalField, i: number) {
  return consolidateCover(
    map,
    i,
    () => Infinity,
    "burial",
    (layer) => ({
      ...layer,
      strength: Math.min(layer.strength, rockCatalogue.alluvium.resistance),
      damage: Math.max(layer.damage, 0.5),
      altered: map.CompletedEpochCount,
    })
  );
}
function consolidateCover(
  map: PhysicalField,
  i: number,
  amount: (cover: number) => number,
  cause: FlowCause,
  response: (layer: MaterialLayer) => MaterialLayer
) {
  const stored = groundStorage(map);
  let hardened = 0;
  for (const facet of ["land", "cut"] as const) {
    const share = facetShare(map, i, facet);
    if (share <= 0) continue;
    const cover = columnThickness(map, i, coverColumn(facet)),
      wanted = Math.min(amount(cover), cover);
    if (wanted <= 0) continue;
    const layers: MaterialLayer[] = [],
      actual = withdrawBuried(map, i, coverColumn(facet), wanted, (layer) =>
        layers.push(response(layer))
      );
    if (actual <= 0) continue;
    layDownPackage(map, i, facet, layers.reverse());
    hardened += actual * share;
    stored.GroundCutDepth.add(i, facet === "land" ? actual : -actual);
  }
  if (hardened <= 0) return 0;
  stored.BedrockElevation.add(i, hardened);
  stored.SurfaceRockLoad.add(i, hardened);
  recordFlow(map, cause, "loose", "rock", (hardened / 1024) * map.mesh.area(i));
  projectGround(map, i);
  return hardened;
}
