import type { PhysicalField } from "../world/field";
import { clamp } from "../world/math";
import { columnFields, type Column } from "@atlas/domain";
import {
  coarsenColumn,
  deepestLayer,
  mergeMaterial,
  readLayer,
  setLayer,
  type MaterialLayer,
} from "./rockColumn";
import { columnThickness, cutShare, facetSurface, rockSurface } from "./groundShares";
import type { MaterialReceiver } from "./groundMaterial";
import { groundStorage } from "./groundStorage";

/** Volume demands attributed to the original facets, before any simultaneous withdrawals land. */
export function incisionDemand(
  map: PhysicalField,
  cell: number,
  budget: number,
  requestedShare: number,
  floor: number
) {
  const old = cutShare(map, cell),
    wanted = clamp(requestedShare, 0, 1),
    landSurface = facetSurface(map, cell, "land"),
    oldSurface = old > 0 ? facetSurface(map, cell, "cut") : landSurface,
    gap = Math.max(0, landSurface - Math.max(oldSurface, floor)),
    added = Math.max(0, wanted - old),
    widening = Math.min(budget, added * gap),
    reached = old + (gap > 0 ? Math.min(added, budget / gap) : added),
    deepening = reached > 0 ? Math.max(0, budget - widening) / reached : 0;
  return {
    land: sliceDemand(gap + deepening, reached - old, columnThickness(map, cell, "loose")),
    cut: sliceDemand(deepening, old, columnThickness(map, cell, "cutLoose")),
  };
}
const sliceDemand = (depth: number, share: number, cover: number) => ({
  loose: Math.min(depth, cover) * share,
  rock: Math.max(0, depth - cover) * share,
});

const snapshot = (map: PhysicalField, cell: number, column: Column) =>
  Array.from({ length: deepestLayer(map, cell, column) + 1 }, (_, slot) =>
    readLayer(map, cell, slot, column)
  ).filter((layer) => layer.depth > 0 || column === "land" || column === "cut");

/** A temporary slice of the existing intact stack; the surviving intact share is never edited. */
function withdrawSlice(
  layers: MaterialLayer[],
  amount: number,
  solid: boolean,
  receive: MaterialReceiver
) {
  let left = amount;
  while (layers.length && left > 0) {
    const top = layers[0],
      basement = solid && layers.length === 1,
      taken = Math.min(left, basement ? left : top.depth);
    if (taken > 0) receive({ ...top, depth: taken });
    left -= taken;
    if (basement || top.depth > taken) {
      layers[0] = { ...top, depth: Math.max(basement ? 1 : 0, top.depth - taken) };
      break;
    }
    layers.shift();
  }
  return amount - left;
}

/**
 * Unresolved neighboring profiles become area-weighted bed packages. Their internal bed order
 * survives until the ordinary capacity merge; their horizontal contact alignment does not.
 * Both basement constituents remain in the final unbounded layer.
 */
function combine(old: MaterialLayer[], incoming: MaterialLayer[], share: number, solid: boolean) {
  const oldBeds = solid ? old.slice(0, -1) : old,
    newBeds = solid ? incoming.slice(0, -1) : incoming,
    layers = [
      ...oldBeds.map((layer) => ({ ...layer, depth: layer.depth * (1 - share) })),
      ...newBeds.map((layer) => ({ ...layer, depth: layer.depth * share })),
    ].filter((layer) => layer.depth > 0);
  if (solid) {
    const a = old[old.length - 1],
      b = incoming[incoming.length - 1],
      basement = mergeMaterial({ ...a, depth: 1 - share }, { ...b, depth: share });
    layers.push({ ...basement, depth: Math.max(1, a.depth * (1 - share) + b.depth * share) });
  }
  return layers;
}
function install(map: PhysicalField, cell: number, column: Column, layers: MaterialLayer[]) {
  const size = columnFields[column].kind.length;
  while (layers.length > size) coarsenColumn(layers, cell, column);
  for (let slot = 0; slot < size; slot++) {
    const layer = layers[slot];
    setLayer(map, cell, slot, layer?.kind ?? 0, layer?.depth ?? 0, layer, column);
  }
}
interface Widened {
  amount: number;
  rock: number;
  loose: number;
  soil: number;
  cutSkin: number;
  share: number;
}

/**
 * Excavate as much additional width as the budget pays for, down to the existing floor. The
 * ledger books the returned mean rock lowering immediately, then may spend the remaining work
 * deepening this combined floor. No material is removed from the remaining intact column.
 */
export function widenIncision(
  map: PhysicalField,
  cell: number,
  requestedShare: number,
  budget: number,
  minimumSurface: number,
  receive: MaterialReceiver
): Widened {
  const oldShare = cutShare(map, cell),
    wanted = clamp(requestedShare, 0, 1),
    skin = map.SoilDepth.get(cell),
    empty = { amount: 0, rock: 0, loose: 0, soil: 0, cutSkin: skin, share: oldShare },
    landSurface = facetSurface(map, cell, "land");
  if (budget <= 0 || wanted <= oldShare || landSurface <= minimumSurface) return empty;
  const oldSurface = oldShare > 0 ? facetSurface(map, cell, "cut") : landSurface,
    gap = Math.max(0, landSurface - Math.max(oldSurface, minimumSurface)),
    added = gap > 0 ? Math.min(wanted - oldShare, budget / gap) : wanted - oldShare;
  if (added <= 0) return empty;
  return widenSlice(map, cell, { oldShare, added, gap, skin }, receive);
}
interface Widening {
  oldShare: number;
  added: number;
  gap: number;
  skin: number;
}
function widenSlice(
  map: PhysicalField,
  cell: number,
  work: Widening,
  receive: MaterialReceiver
): Widened {
  const { oldShare, added, gap, skin } = work,
    share = oldShare + added,
    landRock = rockSurface(map, cell, "land"),
    oldRock = oldShare > 0 ? rockSurface(map, cell, "cut") : landRock,
    rock = snapshot(map, cell, "land"),
    loose = snapshot(map, cell, "loose"),
    accept = (layer: MaterialLayer) => receive({ ...layer, depth: layer.depth * added }),
    looseRemoved = withdrawSlice(loose, gap, false, accept),
    rockRemoved = withdrawSlice(rock, gap - looseRemoved, true, accept),
    fraction = added / share;
  install(
    map,
    cell,
    "cut",
    oldShare > 0 ? combine(snapshot(map, cell, "cut"), rock, fraction, true) : rock
  );
  install(
    map,
    cell,
    "cutLoose",
    oldShare > 0 ? combine(snapshot(map, cell, "cutLoose"), loose, fraction, false) : loose
  );
  const nextRock = (oldShare * oldRock + added * (landRock - rockRemoved)) / share,
    soil = Math.min(skin, MapScale.metres(gap, "native")) * added;
  groundStorage(map).GroundCutShare.set(cell, share);
  groundStorage(map).GroundCutDepth.set(cell, landRock - nextRock);
  return {
    amount: gap * added,
    rock: rockRemoved * added,
    loose: looseRemoved * added,
    soil,
    cutSkin: (skin * oldShare + Math.max(0, skin - MapScale.metres(gap, "native")) * added) / share,
    share,
  };
}
import { MapScale } from "@atlas/domain";
