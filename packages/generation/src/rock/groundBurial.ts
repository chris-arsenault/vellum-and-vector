import { columnFields } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { clamp } from "../world/math";
import { recordFlow, type FlowCause } from "../coupling/flows";
import {
  columnSize,
  blendLayers,
  insertColumnPackage,
  layDownPackage,
  readLayer,
  setLayer,
  type MaterialLayer,
} from "./rockColumn";
import { burialResponse } from "./modes";
import { withdrawBuried } from "./groundMaterial";
import {
  coverColumn,
  columnThickness,
  facetShare,
  projectGround,
  type GroundFacet,
} from "./groundShares";
import { groundStorage } from "./groundStorage";
import { writeCargo } from "./groundCargo";

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
  const fraction = clamp(hardened, 0, 1);
  if (fraction <= 0) return 0;
  let changed = false;
  for (const facet of ["land", "cut"] as const)
    if (facetShare(map, i, facet) > 0)
      changed = consolidateBeds(map, i, facet, threshold, fraction) || changed;
  const converted = consolidateCover(
    map,
    i,
    (cover) => Math.max(0, cover - threshold) * fraction,
    cause,
    (layer) => burialResponse(layer, map.CompletedEpochCount)
  );
  if (changed) projectGround(map, i);
  return converted;
}
/** A bounded bed averages its buried fraction; intact rock still contributes overburden. */
function consolidateBeds(
  map: PhysicalField,
  cell: number,
  facet: GroundFacet,
  threshold: number,
  fraction: number
) {
  let above = columnThickness(map, cell, coverColumn(facet)),
    changed = false;
  for (let slot = 0; slot < columnSize(facet); slot++) {
    const layer = readLayer(map, cell, slot, facet);
    if (layer.depth <= 0) break;
    const eligible = clamp((above + layer.depth - threshold) / layer.depth, 0, 1);
    above += layer.depth;
    if (eligible <= 0 || layer.consolidation >= 1) continue;
    const response = burialResponse(layer, map.CompletedEpochCount);
    if (layer.consolidation >= response.consolidation) continue;
    const material = partiallyConsolidated(layer, response, fraction * eligible);
    setLayer(map, cell, slot, material.kind, material.depth, material, facet);
    changed = true;
  }
  return changed;
}
/** Clast facts survive cementation; a converting loose constituent retains its remaining share. */
function partiallyConsolidated(
  layer: MaterialLayer,
  response: MaterialLayer,
  fraction: number
): MaterialLayer {
  if (fraction >= 1) return response;
  if (layer.kind !== response.kind || layer.secondaryKind !== response.secondaryKind)
    return {
      ...blendLayers({ ...layer, depth: 1 - fraction }, { ...response, depth: fraction }),
      depth: layer.depth,
    };
  return {
    ...layer,
    damage: layer.damage + (response.damage - layer.damage) * fraction,
    consolidation: layer.consolidation + (response.consolidation - layer.consolidation) * fraction,
    altered: response.altered,
  };
}
/** Overburden entombs cover as a weak bed; it does not instantly restore intact clast strength. */
const entombed = (layer: MaterialLayer, epoch: number): MaterialLayer => ({
  ...layer,
  damage: Math.max(layer.damage, 0.5),
  altered: epoch,
  consolidation: 0,
});
export function buryCover(map: PhysicalField, i: number, only?: GroundFacet) {
  return consolidateCover(
    map,
    i,
    () => Infinity,
    "burial",
    (layer) => entombed(layer, map.CompletedEpochCount),
    only
  );
}
/** Collision owner helper: bury existing cover before inserting incoming rock, then account once.
 * The caller publishes after its admitted rock also changes placement. */
export function buryUnderPackage(
  map: PhysicalField,
  i: number,
  incoming: readonly MaterialLayer[]
) {
  const stored = groundStorage(map);
  let buried = 0;
  for (const facet of ["land", "cut"] as const) {
    const share = facetShare(map, i, facet);
    if (share <= 0) continue;
    const cover = coverColumn(facet),
      depths = columnFields[cover].depth,
      layers: MaterialLayer[] = [];
    let depth = 0;
    for (let slot = 0; slot < columnSize(cover) && stored[depths[slot]].get(i) > 0; slot++) {
      const layer = readLayer(map, i, slot, cover);
      layers.push(entombed(layer, map.CompletedEpochCount));
      depth += layer.depth;
      stored[depths[slot]].set(i, 0);
      writeCargo(map, i, slot, cover);
    }
    // Both inputs are top-first: reverse insertion visits buried cover before incoming rock.
    insertColumnPackage(map, i, facet, [...incoming, ...layers]);
    buried += depth * share;
    stored.GroundCutDepth.add(i, facet === "land" ? depth : -depth);
  }
  if (buried <= 0) return;
  stored.BedrockElevation.add(i, buried);
  stored.SurfaceRockLoad.add(i, buried);
  recordFlow(map, "burial", "loose", "rock", MapScale.metres(buried, "native") * map.mesh.area(i));
}
function consolidateCover(
  map: PhysicalField,
  i: number,
  amount: (cover: number) => number,
  cause: FlowCause,
  response: (layer: MaterialLayer) => MaterialLayer,
  only?: GroundFacet
) {
  const stored = groundStorage(map);
  let hardened = 0;
  for (const facet of only ? [only] : (["land", "cut"] as const)) {
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
  recordFlow(map, cause, "loose", "rock", MapScale.metres(hardened, "native") * map.mesh.area(i));
  projectGround(map, i);
  return hardened;
}
import { MapScale } from "@atlas/domain";
