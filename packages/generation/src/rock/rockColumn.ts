import type { PhysicalField } from "../world/field";
import { rockKindOfCode, type RockKind } from "./rockCatalogue";
import { projectGround } from "./groundShares";
import { groundStorage } from "./groundStorage";
import {
  allColumnFields,
  blendLayers,
  columnFields,
  materialLayer,
  materialProperties,
  rockLayerDepths,
  rockLayerKinds,
  rockLayers,
  type Column,
  type MaterialProperty,
  type MaterialLayer,
  type MaterialState,
} from "./rockLayerFields";

/**
 * Bounded strata on the field's own bands. Material state travels with each bed. Land and cut
 * columns have an unbounded basement; their loose covers are finite. Placement belongs to Ground.
 */
export { rockLayers, allColumnFields, columnFields, type Column };
export {
  materialLayer,
  blendLayers,
  mergeMaterial,
  materialStrength,
  type MaterialLayer,
  type MaterialState,
} from "./rockLayerFields";
const kinds = rockLayerKinds,
  depths = rockLayerDepths;
export const rockColumnFields = [...kinds, ...depths] as const;
export const finiteColumn = (column: Column) => column === "loose" || column === "cutLoose";
export const columnSize = (column: Column) => columnFields[column].kind.length;
function eachRockFacet(map: PhysicalField, cell: number, act: (column: Column) => void) {
  const cut = map.GroundCutShare.get(cell);
  if (cut < 1) act("land");
  if (cut > 0) act("cut");
}
/** Sees rock lost to a full column, and rock stripped off the top, for a run's report. */
export interface ColumnWatcher {
  /** A layer folded into the one below, `above` beneath the surface; `into` is what it became. */
  fold(cell: number, kind: number, into: number, thickness: number, above: number): void;
  strip(cell: number, amount: number): void;
  merge?(cell: number, column: Column, layer: number, result: MaterialLayer): void;
}
const watchers = new Set<ColumnWatcher>();
/** Starts watching; the returned function stops. */
export function watchColumn(watcher: ColumnWatcher) {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}
export const layerValue = (
  map: PhysicalField,
  cell: number,
  layer: number,
  property: MaterialProperty,
  column: Column = "land"
) => groundStorage(map)[columnFields[column][property][layer]].get(cell);
export const layerKind = (
  map: PhysicalField,
  cell: number,
  layer: number,
  column: Column = "land"
) => layerValue(map, cell, layer, "kind", column);
export const layerDepth = (
  map: PhysicalField,
  cell: number,
  layer: number,
  column: Column = "land"
) => layerValue(map, cell, layer, "depth", column);
/** A scalar snapshot: later column writes cannot change a retained query result. */
export function readLayer(
  map: PhysicalField,
  cell: number,
  layer: number,
  column: Column = "land"
): MaterialLayer {
  const fields = columnFields[column],
    stored = groundStorage(map),
    value = (property: MaterialProperty) => stored[fields[property][layer]].get(cell),
    kind = value("kind");
  return {
    kind,
    depth: value("depth"),
    secondaryKind: value("secondaryKind"),
    secondaryShare: value("secondaryShare"),
    strength: value("strength") || rockKindOfCode(kind).resistance,
    damage: value("damage"),
    grainX: value("grainX"),
    grainY: value("grainY"),
    bedSlopeX: value("bedSlopeX"),
    bedSlopeY: value("bedSlopeY"),
    deposited: value("deposited"),
    consolidation: value("consolidation"),
    formedMin: value("formedMin"),
    formedMax: value("formedMax"),
    altered: value("altered"),
    mixed: value("mixed"),
  };
}
export function setLayer(
  map: PhysicalField,
  cell: number,
  layer: number,
  kind: number,
  depth: number,
  state: MaterialState = {},
  column: Column = "land"
) {
  const material = materialLayer(kind, depth, state, map.CompletedEpochCount),
    stored = groundStorage(map),
    fields = columnFields[column];
  for (const property of materialProperties)
    stored[fields[property][layer]].set(cell, material[property]);
}
/** Copy every fact, including alteration and age, without reconstructing it from the kind. */
export function copyLayer(
  map: PhysicalField,
  cell: number,
  to: number,
  from: number,
  column: Column = "land",
  fromColumn: Column = column
) {
  const stored = groundStorage(map),
    target = columnFields[column],
    source = columnFields[fromColumn];
  for (const property of materialProperties)
    stored[target[property][to]].set(cell, stored[source[property][from]].get(cell));
}

/** A column's layers fill from the top with none empty between, so this is its basement. */
export function deepestLayer(map: PhysicalField, cell: number, column: Column = "land") {
  let layer = 0;
  while (layer < columnSize(column) - 1 && layerDepth(map, cell, layer + 1, column) > 0) layer++;
  return layer;
}
/** Strips rock from the top of a column, uncovering what lies beneath. */
export function stripRock(
  map: PhysicalField,
  cell: number,
  amount: number,
  column: Column = "land"
) {
  let left = Math.max(0, amount);
  while (left > 0) {
    const top = layerDepth(map, cell, 0, column);
    if (top > left || layerDepth(map, cell, 1, column) <= 0) {
      // A positive marker keeps an exhausted basement beneath a future deposited bed. Its
      // recorded thickness never limits withdrawal; zero is reserved for an empty stack slot.
      const floor = finiteColumn(column) || layerDepth(map, cell, 1, column) > 0 ? 0 : 1,
        remaining = Math.max(floor, top - left);
      groundStorage(map)[columnFields[column].depth[0]].set(cell, remaining);
      left = finiteColumn(column) ? Math.max(0, left - top) : 0;
      break;
    }
    left -= top;
    for (let layer = 0; layer < columnSize(column) - 1; layer++)
      copyLayer(map, cell, layer, layer + 1, column);
    groundStorage(map)[columnFields[column].depth[columnSize(column) - 1]].set(cell, 0);
  }
  projectGround(map, cell);
  const removed = Math.max(0, amount) - left;
  for (const watcher of watchers) watcher.strip(cell, removed);
  return removed;
}
/** Actual material intersected by a depth; finite cover can return less than requested. */
export function materialThrough(
  map: PhysicalField,
  cell: number,
  amount: number,
  column: Column = "land"
) {
  let left = Math.max(0, amount),
    result: MaterialLayer | undefined;
  const bottom = deepestLayer(map, cell, column);
  for (let at = 0; at <= bottom && left > 0; at++) {
    const layer = readLayer(map, cell, at, column),
      available = at === bottom && !finiteColumn(column) ? left : layer.depth,
      taken = Math.min(left, available);
    if (taken <= 0) continue;
    const part = { ...layer, depth: taken };
    result = result ? blendLayers(result, part) : part;
    left -= taken;
  }
  return result;
}
/** Owner-only capacity reduction for a temporary package, including combined incision profiles. */
export function coarsenColumn(layers: MaterialLayer[], cell: number, column: Column) {
  const upper = coarseningContact(layers, column),
    a = layers[upper],
    b = layers[upper + 1],
    combined = blendLayers(a, b);
  let above = 0;
  for (let layer = 0; layer < upper; layer++) above += layers[layer].depth;
  for (const watcher of watchers) {
    watcher.fold(cell, a.kind, combined.kind, a.depth, above);
    watcher.merge?.(cell, column, upper, { ...combined });
  }
  layers.splice(upper, 2, combined);
}
/** Prefer an equivalent contact, then the least represented depth; ties retain shallower detail. */
function coarseningContact(layers: MaterialLayer[], column: Column) {
  // The incoming cap is already at zero. Finite cover has no basement to exclude.
  let best = layers.length - (finiteColumn(column) ? 2 : 3),
    equivalent = sameMaterial(layers[best], layers[best + 1]),
    thickness = layers[best].depth + layers[best + 1].depth;
  for (let at = best - 1; at >= 1; at--) {
    const candidate = sameMaterial(layers[at], layers[at + 1]),
      depth = layers[at].depth + layers[at + 1].depth;
    if ((candidate && !equivalent) || (candidate === equivalent && depth < thickness)) {
      best = at;
      equivalent = candidate;
      thickness = depth;
    }
  }
  return best;
}
function sameMaterial(a: MaterialLayer, b: MaterialLayer) {
  return (
    a.kind === b.kind &&
    a.secondaryKind === b.secondaryKind &&
    a.secondaryShare === b.secondaryShare &&
    a.strength === b.strength &&
    a.damage === b.damage &&
    a.grainX === b.grainX &&
    a.grainY === b.grainY &&
    sameBed(a, b) &&
    a.altered === b.altered &&
    a.mixed === b.mixed
  );
}
const sameBed = (a: MaterialLayer, b: MaterialLayer) =>
  a.bedSlopeX === b.bedSlopeX &&
  a.bedSlopeY === b.bedSlopeY &&
  a.deposited === b.deposited &&
  a.consolidation === b.consolidation;
/** Every nonempty deposit arrives as material; capacity may coarsen buried contacts, never discard it. */
export function layDownRock(
  map: PhysicalField,
  cell: number,
  kind: RockKind,
  amount: number,
  state: MaterialState = {},
  column: Column = "land"
) {
  if (amount <= 0) return;
  layDownPackage(map, cell, column, [
    materialLayer(kind.code, amount, state, map.CompletedEpochCount),
  ]);
}
/**
 * Top-first incoming beds; coarsen after each burial, then commit surviving slots once. This bounded
 * representation can lose a thin buried barrier, even though its material and age remain in a mixture.
 */
export function layDownPackage(
  map: PhysicalField,
  cell: number,
  column: Column,
  incoming: readonly MaterialLayer[]
) {
  insertColumnPackage(map, cell, column, incoming);
  projectGround(map, cell);
}
/** Owner-only insertion; the complete operation publishes after placement and cover also settle. */
export function insertColumnPackage(
  map: PhysicalField,
  cell: number,
  column: Column,
  incoming: readonly MaterialLayer[]
) {
  const size = columnSize(column),
    stored = groundStorage(map),
    fields = columnFields[column],
    // hpc-exempt: at most nine transient bed snapshots before coarsening, never per-cell storage.
    layers: MaterialLayer[] = [];
  for (let slot = 0; slot < size && stored[fields.depth[slot]].get(cell) > 0; slot++)
    layers.push(readLayer(map, cell, slot, column));
  for (let at = incoming.length - 1; at >= 0; at--) {
    const bed = incoming[at];
    if (bed.depth <= 0) continue;
    const top = layers[0];
    if (top && sameMaterial(top, bed))
      layers[0] = {
        ...bed,
        depth: top.depth + bed.depth,
        formedMin: Math.min(top.formedMin, bed.formedMin),
        formedMax: Math.max(top.formedMax, bed.formedMax),
      };
    else {
      layers.unshift(bed);
      if (layers.length > size) coarsenColumn(layers, cell, column);
    }
  }
  writeColumn(map, cell, column, layers);
}
function writeColumn(map: PhysicalField, cell: number, column: Column, layers: MaterialLayer[]) {
  const stored = groundStorage(map),
    fields = columnFields[column];
  for (const property of materialProperties)
    for (let slot = 0; slot < layers.length; slot++)
      stored[fields[property][slot]].set(cell, layers[slot][property]);
  for (let slot = layers.length; slot < columnSize(column); slot++)
    stored[fields.depth[slot]].set(cell, 0);
}
/**
 * Melt that never rose cools as new rock below: a column's basement becomes it, and a column that is
 * all one rock keeps a shell of that rock over it, since melt does not reach the surface unseen.
 */
export function intrudeBasement(
  map: PhysicalField,
  cell: number,
  kind: RockKind,
  shell: number,
  column?: Column
) {
  if (column === undefined)
    return eachRockFacet(map, cell, (facet) => intrudeBasement(map, cell, kind, shell, facet));
  const deepest = deepestLayer(map, cell, column);
  if (deepest > 0) {
    changeLayer(map, cell, deepest, kind, column);
    return;
  }
  const whole = layerDepth(map, cell, 0, column);
  if (whole <= shell) return;
  groundStorage(map)[columnFields[column].depth[0]].set(cell, shell);
  setLayer(map, cell, 1, kind.code, whole - shell, {}, column);
}
/** Rock changed where it lies, in any layer. */
export function changeLayer(
  map: PhysicalField,
  cell: number,
  layer: number,
  kind: RockKind,
  column?: Column
) {
  if (column === undefined)
    return eachRockFacet(map, cell, (facet) => changeLayer(map, cell, layer, kind, facet));
  const was = readLayer(map, cell, layer, column);
  setLayer(
    map,
    cell,
    layer,
    kind.code,
    was.depth,
    {
      ...was,
      secondaryKind: kind.code,
      secondaryShare: 0,
      strength: kind.resistance,
      mixed: 0,
      altered: map.CompletedEpochCount,
    },
    column
  );
  if (layer === 0) projectGround(map, cell);
}
/** The top of the rock changes where it lies: no height moves, the column just holds new rock. */
export function alterTop(
  map: PhysicalField,
  cell: number,
  kind: RockKind,
  depth: number,
  column?: Column
) {
  if (column === undefined)
    return eachRockFacet(map, cell, (facet) => alterTop(map, cell, kind, depth, facet));
  if (depth <= 0) return;
  const was = materialThrough(map, cell, depth, column);
  if (!was) return;
  const amount = stripRock(map, cell, depth, column);
  layDownRock(
    map,
    cell,
    kind,
    amount,
    {
      formedMin: was.formedMin,
      formedMax: was.formedMax,
      grainX: was.grainX,
      grainY: was.grainY,
      bedSlopeX: was.bedSlopeX,
      bedSlopeY: was.bedSlopeY,
      deposited: was.deposited,
      consolidation: was.consolidation,
      damage: was.damage,
      altered: map.CompletedEpochCount,
    },
    column
  );
}
/** A column's two top layers trade places, or its second and third, as a share picks. */
export function shuffleLayers(map: PhysicalField, cell: number, share: number, column?: Column) {
  if (column === undefined)
    return eachRockFacet(map, cell, (facet) => shuffleLayers(map, cell, share, facet));
  const upper = share < 0.5 ? 0 : 1,
    was = readLayer(map, cell, upper, column);
  if (layerDepth(map, cell, upper + 1, column) <= 0) return;
  copyLayer(map, cell, upper, upper + 1, column);
  setLayer(map, cell, upper + 1, was.kind, was.depth, was, column);
  projectGround(map, cell);
}
