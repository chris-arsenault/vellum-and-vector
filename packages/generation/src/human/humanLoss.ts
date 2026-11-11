import {
  humanLayerIds,
  humanRemains,
  type Band,
  type HumanLayerId,
  type ReadBand,
} from "@atlas/domain";
import { layerCatalogue, type CompiledLayerMix } from "./layerCatalogue";
import { positive, unit, type LayerBands } from "./layerBands";

/**
 * How people's layers are lost and what they leave. Part of the layers' owner: these run only
 * from the owner's registered operations.
 */
type Values = Pick<ReadBand, "get">;

/** A kind loses some of what a cell holds, and a kind whose losses are kept counts them. */
function take(layers: LayerBands, kind: HumanLayerId, cell: number, taken: number) {
  layers.of[kind].add(cell, -taken);
  const counted = layerCatalogue[kind].ground?.losses;
  if (counted) layers.map[counted].add(cell, taken * layers.km2(cell));
}
/** Remains are left on a cell, in the open or under cover, in their builders' tongue. */
function leave(
  layers: LayerBands,
  cell: number,
  band: Band,
  amount: number,
  covered: number,
  tongue: number
) {
  const ruins = layers.map[humanRemains.builtUp],
    cover = layers.map[humanRemains.cover];
  if (band !== ruins) {
    if (amount > 0) band.add(cell, amount);
    return;
  }
  // Remains cover ground once: what falls on older remains lies among them.
  const before = ruins.get(cell),
    added = Math.min(amount, 1 - before);
  if (added <= 0) return;
  cover.set(cell, (cover.get(cell) * before + covered * added) / (before + added));
  // Remains speak the tongue of whoever built most of them, where anyone is left to say.
  if (tongue && (added >= before || !layers.map[humanRemains.tongue].get(cell)))
    layers.map[humanRemains.tongue].set(cell, tongue);
  ruins.add(cell, added);
}
/** Each kind of a cell loses its share; identities thin with the people who held them. */
function lose(
  layers: LayerBands,
  cell: number,
  share: (kind: HumanLayerId, index: number) => number,
  left: (index: number) => number,
  covered: number
) {
  const living = layers.people(cell),
    tongue = layers.column(cell)[0]?.tongue ?? 0;
  for (const [index, kind] of humanLayerIds.entries()) {
    const taken = layers.of[kind].get(cell) * unit(share(kind, index)),
      remains = layerCatalogue[kind].remains;
    if (!(taken > 0)) continue;
    take(layers, kind, cell, taken);
    if (remains)
      leave(layers, cell, layers.map[remains.band], taken * left(index), covered, tongue);
  }
  if (living > 0) layers.thinColumn(cell, layers.people(cell) / living);
}
/**
 * Something acts on the layers: each kind loses what its facts give up to the action's modes
 * at the cell's intensity, less what the place's standing holds, and what its facts say stays
 * is left as remains in the open.
 */
export function wearLayers(layers: LayerBands, mix: CompiledLayerMix, intensity: Values) {
  for (let cell = 0; cell < layers.count; cell++) {
    const force = positive(intensity.get(cell));
    if (!force) continue;
    const held = layers.standing(cell);
    lose(
      layers,
      cell,
      (kind, index) =>
        (1 - Math.exp(-mix.yields[index] * force)) /
        (1 + layerCatalogue[kind].standingHolds * held),
      (index) => mix.left[index],
      0
    );
  }
}
/**
 * Ground or water covers a share of each cell: that share of every layer is gone from the
 * surface, what leaves remains lies under the cover, and remains already there are covered.
 */
export function buryLayers(layers: LayerBands, covered: Values) {
  const cover = layers.map[humanRemains.cover];
  for (let cell = 0; cell < layers.count; cell++) {
    const share = unit(covered.get(cell));
    if (!share) continue;
    cover.set(cell, cover.get(cell) + (1 - cover.get(cell)) * share);
    lose(
      layers,
      cell,
      () => share,
      () => 1,
      1
    );
  }
}
/** What covered a share of each cell's remains is gone, and they lie in the open again. */
export function reExposeLayers(layers: LayerBands, share: Values) {
  const cover = layers.map[humanRemains.cover];
  for (let cell = 0; cell < layers.count; cell++) {
    const opened = unit(share.get(cell));
    if (opened) cover.set(cell, cover.get(cell) * (1 - opened));
  }
}
