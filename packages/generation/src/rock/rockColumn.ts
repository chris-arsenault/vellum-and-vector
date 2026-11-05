import type { PhysicalField } from "../canonry/field";
import { rockKindOfCode, softestRock, hardestRock, type RockKind } from "./rockCatalogue";

/**
 * Each cell's rock as a short stack on the field's own bands: the top layer is what the surface is,
 * and everything below waits to be uncovered. Erosion strips from the top, deposition and eruption
 * add to it, and the bottom layer is the basement, which never runs out. The field's rock resistance
 * follows whatever is exposed, keeping whatever magic has done to that surface.
 */
export const rockLayers = 8;
const kinds = [
  "RockLayerKind0",
  "RockLayerKind1",
  "RockLayerKind2",
  "RockLayerKind3",
  "RockLayerKind4",
  "RockLayerKind5",
  "RockLayerKind6",
  "RockLayerKind7",
] as const;
const depths = [
  "RockLayerDepth0",
  "RockLayerDepth1",
  "RockLayerDepth2",
  "RockLayerDepth3",
  "RockLayerDepth4",
  "RockLayerDepth5",
  "RockLayerDepth6",
  "RockLayerDepth7",
] as const;
export const rockColumnFields = [...kinds, ...depths] as const;

export const layerKind = (map: PhysicalField, cell: number, layer: number) =>
  map[kinds[layer]].get(cell);
export const layerDepth = (map: PhysicalField, cell: number, layer: number) =>
  map[depths[layer]].get(cell);
export const setLayer = (
  map: PhysicalField,
  cell: number,
  layer: number,
  kind: number,
  depth: number
) => {
  map[kinds[layer]].set(cell, kind);
  map[depths[layer]].set(cell, depth);
};

/** A column's layers fill from the top with none empty between, so this is its basement. */
export function deepestLayer(map: PhysicalField, cell: number) {
  let layer = 0;
  while (layer < rockLayers - 1 && layerDepth(map, cell, layer + 1) > 0) layer++;
  return layer;
}
const alterationCarried = 1000;
/** The surface takes on a new rock: its own resistance, plus what had been done to the old one. */
function expose(map: PhysicalField, cell: number, was: RockKind) {
  const now = rockKindOfCode(map.RockLayerKind0.get(cell)),
    // What was done to a surface is bounded: a thin alteration does not reach far down the column.
    altered = Math.max(
      -alterationCarried,
      Math.min(alterationCarried, map.RockResistance.get(cell) - was.resistance)
    );
  map.RockKindCodes.set(cell, now.code);
  map.RockResistance.set(
    cell,
    Math.max(softestRock, Math.min(hardestRock, now.resistance + altered))
  );
}
/** Strips rock from the top of a column, uncovering what lies beneath. */
export function stripRock(map: PhysicalField, cell: number, amount: number) {
  let left = amount,
    uncovered = false;
  const was = rockKindOfCode(map.RockLayerKind0.get(cell));
  while (left > 0) {
    const top = map.RockLayerDepth0.get(cell);
    if (top > left || map.RockLayerDepth1.get(cell) <= 0) {
      map.RockLayerDepth0.set(cell, Math.max(0, top - left));
      break;
    }
    left -= top;
    for (let layer = 0; layer < rockLayers - 1; layer++)
      setLayer(map, cell, layer, layerKind(map, cell, layer + 1), layerDepth(map, cell, layer + 1));
    map[depths[rockLayers - 1]].set(cell, 0);
    uncovered = true;
  }
  if (uncovered) expose(map, cell, was);
}
/** A new layer on top. A full column folds its two deepest layers into one. */
export function layDownRock(map: PhysicalField, cell: number, kind: RockKind, amount: number) {
  if (amount <= 0) return;
  const was = rockKindOfCode(map.RockLayerKind0.get(cell));
  if (was.code === kind.code) {
    map.RockLayerDepth0.add(cell, amount);
    return;
  }
  // A deepest layer still empty takes on the kind folded into it: the basement stays what it was.
  if (layerDepth(map, cell, rockLayers - 1) <= 0)
    map[kinds[rockLayers - 1]].set(cell, layerKind(map, cell, rockLayers - 2));
  map[depths[rockLayers - 1]].add(cell, layerDepth(map, cell, rockLayers - 2));
  for (let layer = rockLayers - 2; layer > 0; layer--)
    setLayer(map, cell, layer, layerKind(map, cell, layer - 1), layerDepth(map, cell, layer - 1));
  setLayer(map, cell, 0, kind.code, amount);
  expose(map, cell, was);
}
/** Rock changed where it lies, in any layer. */
export function changeLayer(map: PhysicalField, cell: number, layer: number, kind: RockKind) {
  const was = rockKindOfCode(map.RockLayerKind0.get(cell));
  map[kinds[layer]].set(cell, kind.code);
  if (layer === 0) expose(map, cell, was);
}
/** The top of the rock changes where it lies: no height moves, the column just holds new rock. */
export function alterTop(map: PhysicalField, cell: number, kind: RockKind, depth: number) {
  if (depth <= 0) return;
  stripRock(map, cell, depth);
  layDownRock(map, cell, kind, depth);
}
/** A column's two top layers trade places, or its second and third, as a share picks. */
export function shuffleLayers(map: PhysicalField, cell: number, share: number) {
  const was = rockKindOfCode(map.RockLayerKind0.get(cell)),
    upper = share < 0.5 ? 0 : 1,
    kind = layerKind(map, cell, upper),
    depth = layerDepth(map, cell, upper);
  if (layerDepth(map, cell, upper + 1) <= 0) return;
  setLayer(map, cell, upper, layerKind(map, cell, upper + 1), layerDepth(map, cell, upper + 1));
  setLayer(map, cell, upper + 1, kind, depth);
  expose(map, cell, was);
}
/** How deep a thrust sheet's rock goes: what rides over the next sheet, down to the sheet's floor. */
const sheetFloor = 6000 * 1024;
/**
 * A sheet rides over this column, older rock over younger: what it brings lies on top, its deepest
 * first, from the top of its own column down to its floor. Layers come top first.
 */
export function overthrust(
  map: PhysicalField,
  cell: number,
  layers: readonly { kind: number; depth: number }[]
) {
  const riding: { kind: number; depth: number }[] = [];
  let left = sheetFloor;
  for (const { kind, depth } of layers) {
    if (left <= 0 || depth <= 0) continue;
    riding.push({ kind, depth: Math.min(depth, left) });
    left -= depth;
  }
  for (let n = riding.length - 1; n >= 0; n--)
    layDownRock(map, cell, rockKindOfCode(riding[n].kind), riding[n].depth);
}
/**
 * What a column moves by copying and never by mixing, for a move's dominant source: what the
 * exposed rock and its layers are, and the cell's place in the belt that first reached it.
 */
export const kindBands = (map: PhysicalField) => [
  map.RockKindCodes,
  ...kinds.map((k) => map[k]),
  map.ThrustPairIds,
  map.ThrustSheetIndex,
  map.ThrustSegmentIds,
  map.ThrustAcross,
  map.ThrustDip,
];
/** Where in `kindBands` the column's own layers begin. */
export const columnKindOffset = 1;
export const rockDepthFields = depths;
