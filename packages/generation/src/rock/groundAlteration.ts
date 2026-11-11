import type { Column } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import {
  coarsenPackage,
  deepestLayer,
  finiteColumn,
  finiteSlice,
  readLayer,
  writeColumn,
  type MaterialLayer,
} from "./rockColumn";
import {
  columnThickness,
  coverColumn,
  facetShare,
  projectGround,
  type GroundFacet,
} from "./groundShares";

type MaterialTransform = (material: Readonly<MaterialLayer>) => MaterialLayer;
export interface GroundAlteration {
  /** Native height units, measured from the selected origin. */
  readonly depth: number;
  readonly offset?: number;
  /** Surface includes finite loose cover; rock starts beneath that cover. */
  readonly from?: "surface" | "rock";
  /** Restrict exchange with an existing inventory to represented material, excluding basement. */
  readonly retainedOnly?: boolean;
  readonly transform: MaterialTransform;
  readonly facet?: GroundFacet;
}

/** Split only reached intervals. An unbounded basement retains its unchanged material below them. */
export function alterMaterialInterval(
  layers: readonly MaterialLayer[],
  start: number,
  end: number,
  transform: MaterialTransform,
  basement = false,
  retainedOnly = false
): MaterialLayer[] {
  const result: MaterialLayer[] = [];
  let top = 0;
  for (const [index, layer] of layers.entries()) {
    const unbounded = basement && index === layers.length - 1,
      bottom = unbounded ? Infinity : top + layer.depth,
      first = Math.max(top, start),
      last = Math.min(retainedOnly && unbounded ? top + Math.max(0, layer.depth - 1) : bottom, end);
    if (last <= first) result.push(layer);
    else splitAltered(result, layer, first - top, last - first, transform, unbounded);
    top = bottom;
  }
  return result;
}

function splitAltered(
  result: MaterialLayer[],
  layer: MaterialLayer,
  before: number,
  depth: number,
  transform: MaterialTransform,
  basement: boolean
) {
  const reached = finiteSlice(layer, depth, basement, before),
    changed = transform(reached);
  if (changed === reached) {
    result.push(layer);
    return;
  }
  if (before > 0) result.push(finiteSlice(layer, before, basement));
  result.push({ ...changed, depth });
  const remaining = basement
    ? Math.max(1, layer.depth - before - depth)
    : layer.depth - before - depth;
  if (remaining > 0) result.push(finiteSlice(layer, remaining, basement, before + depth));
}

/** Alter material in place: reach spends actual cover depth and never changes placement or load. */
export function alterGround(map: PhysicalField, cell: number, action: GroundAlteration) {
  const start = Math.max(0, action.offset ?? 0),
    end = start + action.depth;
  if (!(action.depth > 0) || !Number.isFinite(end)) return;
  for (const facet of action.facet ? [action.facet] : (["land", "cut"] as const)) {
    if (facetShare(map, cell, facet) <= 0) continue;
    const cover = coverColumn(facet),
      overburden = action.from === "rock" ? 0 : columnThickness(map, cell, cover);
    if (action.from !== "rock") alterColumn(map, cell, cover, start, end, action);
    if (end > overburden)
      alterColumn(map, cell, facet, Math.max(0, start - overburden), end - overburden, action);
  }
  projectGround(map, cell);
}

function alterColumn(
  map: PhysicalField,
  cell: number,
  column: Column,
  start: number,
  end: number,
  action: GroundAlteration
) {
  // hpc-exempt: bounded temporary column snapshots for one owner operation, not persistent cell storage.
  const layers: MaterialLayer[] = [],
    last = deepestLayer(map, cell, column);
  for (let slot = 0; slot <= last; slot++) {
    const layer = readLayer(map, cell, slot, column);
    if (layer.depth > 0) layers.push(layer);
  }
  const altered = alterMaterialInterval(
    layers,
    start,
    end,
    action.transform,
    !finiteColumn(column),
    action.retainedOnly
  );
  if (altered.length === layers.length && altered.every((layer, index) => layer === layers[index]))
    return;
  coarsenPackage(altered, cell, column);
  writeColumn(map, cell, column, altered);
}
