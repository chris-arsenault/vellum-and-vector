import type { PhysicalField } from "../world/field";
import { reconcileWater } from "../world/field";
import { clamp } from "../world/math";
import { columnFields, columns, materialProperties, type Column } from "./rockLayerFields";
import { writeCargo, touchCargo } from "./groundCargo";
import {
  copyLayer,
  deepestLayer,
  layerDepth,
  materialStrength,
  readLayer,
  type MaterialLayer,
} from "./rockColumn";
import { groundStorage } from "./groundStorage";

export type GroundFacet = "land" | "cut";
export const coverColumn = (facet: GroundFacet): Column =>
  facet === "land" ? "loose" : "cutLoose";
export const cutShare = (map: PhysicalField, cell: number) =>
  clamp(map.GroundCutShare.get(cell), 0, 1);
export const facetShare = (map: PhysicalField, cell: number, facet: GroundFacet) =>
  facet === "cut" ? cutShare(map, cell) : 1 - cutShare(map, cell);
/** Placement is independent of layer thickness: the basement has no represented lower boundary. */
export function rockSurface(map: PhysicalField, cell: number, facet: GroundFacet) {
  return (
    map.BedrockElevation.get(cell) +
    (cutShare(map, cell) - (facet === "cut" ? 1 : 0)) * map.GroundCutDepth.get(cell)
  );
}
export function columnThickness(map: PhysicalField, cell: number, column: Column) {
  let total = 0;
  for (let layer = 0; layer < columnFields[column].depth.length; layer++)
    total += layerDepth(map, cell, layer, column);
  return total;
}
export const facetSurface = (map: PhysicalField, cell: number, facet: GroundFacet) =>
  rockSurface(map, cell, facet) + columnThickness(map, cell, coverColumn(facet));
/** Create the first cut by splitting existing material, without removing or adding any. */
export function openCut(map: PhysicalField, cell: number, share: number) {
  if (cutShare(map, cell) > 0) return;
  for (const [from, to] of [
    ["land", "cut"],
    ["loose", "cutLoose"],
  ] as const)
    for (let layer = 0; layer < columnFields[from].kind.length; layer++)
      copyLayer(map, cell, layer, layer, to, from);
  groundStorage(map).GroundCutShare.set(cell, clamp(share, 0, 1));
  groundStorage(map).GroundCutDepth.set(cell, 0);
}
/** Move one share's rock surface; callers own the corresponding addition/removal of material. */
export function moveFacet(map: PhysicalField, cell: number, facet: GroundFacet, change: number) {
  groundStorage(map).BedrockElevation.add(cell, change * facetShare(map, cell, facet));
  groundStorage(map).GroundCutDepth.add(cell, facet === "land" ? change : -change);
}
/** Refresh read projections after an owner operation, never as a process author's repair step. */
export function projectGround(map: PhysicalField, cell: number) {
  touchCargo(map, cell);
  const share = cutShare(map, cell),
    landCover = columnThickness(map, cell, "loose"),
    valleyCover = share > 0 ? columnThickness(map, cell, "cutLoose") : 0,
    cover = (1 - share) * landCover + share * valleyCover,
    land = readLayer(map, cell, 0),
    valley = share > 0 ? readLayer(map, cell, 0, "cut") : land;
  const owned = groundStorage(map);
  owned.SedimentThickness.set(cell, cover);
  owned.GroundCutCover.set(cell, valleyCover);
  owned.Elevation.set(cell, map.BedrockElevation.get(cell) + cover);
  owned.RockKindCodes.set(cell, share > 0.5 ? valley.kind : land.kind);
  owned.RockResistance.set(
    cell,
    materialStrength(land) * (1 - share) + materialStrength(valley) * share
  );
  owned.StructuralGrainX.set(cell, land.grainX * (1 - share) + valley.grainX * share);
  owned.StructuralGrainY.set(cell, land.grainY * (1 - share) + valley.grainY * share);
  reconcileWater(map, cell);
}
export interface GroundSectionLayer extends MaterialLayer {
  readonly top: number;
  readonly bottom: number;
  readonly share: number;
  readonly medium: "rock" | "loose";
  readonly basement: boolean;
}
/** Small inspection result, not a second persistent representation. */
export function groundSection(map: PhysicalField, cell: number, facet: GroundFacet) {
  const share = facetShare(map, cell, facet),
    result: GroundSectionLayer[] = [];
  if (share <= 0) return result;
  let top = facetSurface(map, cell, facet);
  for (const column of [coverColumn(facet), facet]) {
    const last = deepestLayer(map, cell, column),
      medium = column === facet ? "rock" : "loose";
    for (let slot = 0; slot <= last; slot++) {
      const layer = readLayer(map, cell, slot, column),
        basement = medium === "rock" && slot === last,
        bottom = top - layer.depth;
      if (layer.depth <= 0 && !basement) continue;
      // Stored material survives even when its finite contacts coincide at this elevation.
      if (top === bottom && !basement) continue;
      result.push({ ...layer, top, bottom, share, medium, basement });
      top = bottom;
    }
  }
  return result;
}
/** A fresh crust or explicit imported initial state starts with no inherited incision. */
export function resetShares(map: PhysicalField, cell: number) {
  const owned = groundStorage(map);
  owned.GroundCutShare.set(cell, 0);
  owned.GroundCutDepth.set(cell, 0);
  owned.GroundCutCover.set(cell, 0);
  for (const column of columns.filter((column) => column !== "land")) {
    for (let slot = 0; slot < columnFields[column].depth.length; slot++)
      writeCargo(map, cell, slot, column);
    for (const property of materialProperties)
      for (const name of columnFields[column][property]) owned[name].set(cell, 0);
  }
}
