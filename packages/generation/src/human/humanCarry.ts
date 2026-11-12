import {
  humanBandNames,
  humanLayerIds,
  humanRemains,
  identityColumn,
  type Band,
  type HumanBandName,
  type HumanScalarName,
  type ReadBand,
} from "@atlas/domain";

type Values = Pick<ReadBand, "get">;
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
/** What is counted per person or per work, and so shares out without any ceiling. */
const counted: HumanScalarName[] = [
  ...humanLayerIds
    .filter((id) => layerCatalogue[id].measure === "density")
    .map((id) => layerCatalogue[id].band),
  ...identityColumn.people,
];
/** One band's holdings in each group move to where the weight lies; the group keeps its total. */
function shareOut(layers: LayerBands, band: Band, groups: Values, weight: Values, count: number) {
  const held = new Float64Array(count),
    weighted = new Float64Array(count);
  for (let cell = 0; cell < layers.count; cell++) {
    const group = groups.get(cell);
    if (group < 0 || !layers.ground(cell)) continue;
    const amount = band.get(cell) * layers.km2(cell);
    held[group] += amount;
    weighted[group] += amount * Math.max(0, weight.get(cell));
  }
  for (let cell = 0; cell < layers.count; cell++) {
    const group = groups.get(cell);
    // A group none of whose ground has any weight keeps what it was given, where it was given.
    if (group < 0 || !layers.ground(cell) || !(weighted[group] > 0)) continue;
    band.set(
      cell,
      (band.get(cell) * Math.max(0, weight.get(cell)) * held[group]) / weighted[group]
    );
  }
}
/**
 * A finer map is given each coarser cell's holdings as the same amount on every finer cell
 * under it. They are shared out again by a weight on the finer cells: each coarser cell keeps
 * its people, its works and its land in use, and they lie on the finer ground the weight
 * favours. Land in use never exceeds a cell; what a full cell cannot take stays unshared.
 */
export function apportionLayers(layers: LayerBands, groups: Values, weight: Values) {
  let count = 0;
  for (let cell = 0; cell < layers.count; cell++) count = Math.max(count, groups.get(cell) + 1);
  if (!count) return;
  for (const name of counted) shareOut(layers, layers.map[name], groups, weight, count);
  for (const kind of areaLayers) shareOut(layers, layers.of[kind], groups, weight, count);
  for (let cell = 0; cell < layers.count; cell++) {
    let used = 0;
    for (const kind of areaLayers) used += layers.of[kind].get(cell);
    if (used > 1)
      for (const kind of areaLayers) layers.of[kind].set(cell, layers.of[kind].get(cell) / used);
  }
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
