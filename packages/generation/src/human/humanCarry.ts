import {
  humanBandNames,
  humanLayerIds,
  humanRemains,
  type Band,
  type HumanBandName,
  type HumanScalarName,
} from "@atlas/domain";
import { weightScale, type TransportPlan } from "../world/transportPlan";
import { arriveInColumn } from "./identityColumn";
import { areaLayers, layerCatalogue } from "./layerCatalogue";
import type { LayerBands } from "./layerBands";

/**
 * People's layers ride the crust they stand on. A cell's layers, remains and identity column
 * go together: each arrival brings its share of the ground it came from with everything on it.
 * People and works that arrive are all still there, land in use arrives as the share of the
 * new cell it covers, and identities that arrive join the column whole, never slot by slot.
 * Part of the layers' owner: this runs only from the owner's registered operation.
 */
const summed: HumanScalarName[] = [
  ...humanLayerIds.map((id) => layerCatalogue[id].band),
  humanRemains.builtUp,
  humanRemains.standing,
];
interface Carrying {
  layers: LayerBands;
  /** Every human band as it stood before the crust moved. */
  before: Record<HumanBandName, Band>;
  /** By cell: the most remains any one arrival brought, whose tongue the cell's remains keep. */
  most: Band;
}
/** One arrival: `share` of the target's area came from `source` with everything on it. */
function arrive({ layers, before, most }: Carrying, source: number, target: number, share: number) {
  const map = layers.map;
  for (const name of summed) map[name].add(target, before[name].get(source) * share);
  const ruins = before[humanRemains.builtUp].get(source) * share;
  // Until every arrival is in, the cover band holds covered remains, not their share.
  map[humanRemains.cover].add(target, before[humanRemains.cover].get(source) * ruins);
  if (ruins > most.get(target)) {
    most.set(target, ruins);
    map[humanRemains.tongue].set(target, before[humanRemains.tongue].get(source));
  }
  const arriving = layers.column(source, before);
  if (!arriving.length) return;
  for (const layer of arriving) layer.people *= share;
  layers.writeColumn(target, arriveInColumn(layers.column(target), arriving));
}
/** What a cell holds once everything has arrived: land in use never exceeds the cell. */
function settle(layers: LayerBands, cell: number) {
  const map = layers.map;
  let used = 0;
  for (const kind of areaLayers) used += layers.of[kind].get(cell);
  if (used > 1)
    for (const kind of areaLayers) layers.of[kind].set(cell, layers.of[kind].get(cell) / used);
  const arrived = map[humanRemains.builtUp].get(cell);
  map[humanRemains.cover].set(cell, arrived > 0 ? map[humanRemains.cover].get(cell) / arrived : 0);
  map[humanRemains.builtUp].set(cell, Math.min(1, arrived));
}
export function carryLayers(layers: LayerBands, plan: TransportPlan) {
  const map = layers.map,
    before = Object.fromEntries(
      humanBandNames.map((name) => [name, map.coverage.copyBand(map[name])])
    ) as Record<HumanBandName, Band>,
    most = map.coverage.scratch("float64", "human:carried-remains", layers.count),
    carrying = { layers, before, most };
  most.fill(0);
  for (const name of humanBandNames) map[name].fill(0);
  for (let source = 0; source < layers.count; source++) {
    const end = plan.offsets.get(source + 1);
    for (let offset = plan.offsets.get(source); offset < end; offset++) {
      const target = plan.targets.get(offset);
      if (!layers.ground(target)) continue;
      arrive(
        carrying,
        source,
        target,
        (plan.weights.get(offset) / weightScale) * layers.across(source, target)
      );
    }
  }
  for (let cell = 0; cell < layers.count; cell++) settle(layers, cell);
  map.coverage.release(most);
  for (const band of Object.values(before)) map.coverage.release(band);
}
