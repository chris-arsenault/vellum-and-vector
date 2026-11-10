import type { PhysicalField } from "../world/field";
import type { MaterialReceiver } from "./groundMaterial";
import {
  deepestLayer,
  coarsenPackage,
  finiteColumn,
  readLayer,
  writeColumn,
  type Column,
  type MaterialLayer,
} from "./rockColumn";
import { partitionCargo } from "./materialCargo";

/** Separate a finite constituent while retaining the other constituent and the bed's history. */
export function extractConstituent(layer: MaterialLayer, kind: number, requested: number) {
  const primary = layer.kind === kind ? 1 - layer.secondaryShare : 0,
    secondary = layer.secondaryKind === kind ? layer.secondaryShare : 0,
    share = primary + secondary,
    removed = Math.min(Math.max(0, requested), layer.depth * share),
    depth = layer.depth - removed;
  if (removed <= 0) return { removed: 0, remaining: layer, cargo: undefined };
  const cargo = partitionCargo(layer.cargo, kind, share, removed / layer.depth);
  const a = layer.depth * (1 - layer.secondaryShare) - (removed * primary) / share,
    b = layer.depth * layer.secondaryShare - (removed * secondary) / share,
    remaining = {
      ...layer,
      depth,
      kind: a > 0 ? layer.kind : layer.secondaryKind,
      secondaryKind: layer.secondaryKind,
      secondaryShare: a > 0 && depth > 0 ? b / depth : 0,
      cargo: cargo.remaining,
    };
  return { removed, remaining, cargo: cargo.taken };
}

export interface GroundExtraction {
  readonly kind: number | ((layer: MaterialLayer) => readonly number[]);
  /** Native thickness requested on each occupied facet. Actual availability can return less. */
  readonly amount: number;
  /** Native depth from the original surface. Infinity reaches only the finite retained material. */
  readonly reach: number;
  /** Wind can lift the surface material but cannot pass through a retained cap. */
  readonly surfaceOnly?: boolean;
  readonly looseOnly?: boolean;
  /** Material selection may limit a parcel without equating mineral identity with carried cargo. */
  readonly select?: (layer: MaterialLayer, areaShare: number, kind: number) => number;
}

/** A positive basement marker keeps the column representable but carries no removable inventory. */
export const extractableDepth = (layer: MaterialLayer, basement: boolean) =>
  Math.max(0, layer.depth - (basement ? 1 : 0));

/** Unreached material remains a separate unchanged slice, even within a mixed bed. */
export function extractReached(
  layer: MaterialLayer,
  kind: number,
  amount: number,
  reach: number,
  basement = false
) {
  const reached = Math.max(0, Math.min(reach, extractableDepth(layer, basement))),
    taken = extractConstituent({ ...layer, depth: reached }, kind, amount);
  if (taken.removed <= 0) return { removed: 0, layers: [layer], reached, cargo: undefined };
  const layers: MaterialLayer[] = [];
  if (taken.remaining.depth > 0) layers.push(taken.remaining);
  if (layer.depth > reached) layers.push({ ...layer, depth: layer.depth - reached });
  return { removed: taken.removed, layers, reached, cargo: taken.cargo };
}

/** Owner-only selective withdrawal. Original contacts set reach even after upper material leaves. */
export function extractColumn(
  map: PhysicalField,
  cell: number,
  column: Column,
  action: GroundExtraction,
  skin: number,
  receive?: MaterialReceiver,
  areaShare = 1
) {
  const layers: MaterialLayer[] = [],
    last = deepestLayer(map, cell, column);
  let top = 0,
    removed = 0,
    soil = 0;
  for (let slot = 0; slot <= last; slot++) {
    const layer = readLayer(map, cell, slot, column),
      taken = extractParcel(
        layer,
        action,
        top,
        removed,
        !finiteColumn(column) && slot === last,
        areaShare,
        receive
      );
    removed += taken.removed;
    soil +=
      taken.reached > 0
        ? (taken.removed * Math.max(0, Math.min(taken.reached, skin - top))) / taken.reached
        : 0;
    layers.push(...taken.layers);
    top += layer.depth;
  }
  if (removed > 0) {
    coarsenPackage(layers, cell, column);
    writeColumn(map, cell, column, layers);
  }
  return { removed, soil };
}
/** Every selected constituent spends the same original reached interval, even after removal. */
function extractParcel(
  layer: MaterialLayer,
  action: GroundExtraction,
  top: number,
  before: number,
  basement: boolean,
  areaShare: number,
  receive?: MaterialReceiver
) {
  const reached = Math.max(0, Math.min(action.reach - top, extractableDepth(layer, basement))),
    kinds = typeof action.kind === "number" ? [action.kind] : action.kind(layer);
  let current = { ...layer, depth: reached },
    removed = 0;
  for (const kind of kinds) {
    const taken = extractConstituent(
      current,
      kind,
      Math.min(
        action.amount - before - removed,
        action.select?.(current, areaShare, kind) ?? Infinity
      )
    );
    if (taken.removed <= 0) continue;
    receive?.({
      ...current,
      kind,
      secondaryKind: kind,
      secondaryShare: 0,
      depth: taken.removed,
      cargo: taken.cargo,
    });
    removed += taken.removed;
    current = taken.remaining;
  }
  if (removed <= 0) return { removed: 0, reached, layers: [layer] };
  const layers: MaterialLayer[] = [];
  if (current.depth > 0) layers.push(current);
  if (layer.depth > reached) layers.push({ ...layer, depth: layer.depth - reached });
  return { removed, reached, layers };
}
