// MassWastingLayer.cs, Canonry 0f62584c: synchronous, conservative hillslope transport.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, toUnits, units } from "./math";
import { deposit, erode } from "./surface";

function sourceTransfers(
  map: PhysicalField,
  context: PhysicalContext,
  i: number,
  cuts: Float64Array,
  fills: Float64Array,
  response: number,
  maximum: number
) {
  const p = context.Profile;
  const stable =
    p.MassWastingStableGradient * clamp(0.55 + (map.RockResistance[i] / 1000) * 0.45, 0.55, 1.45);
  const neighbors: number[] = [],
    requested: number[] = [];
  let total = 0,
    maximumExcess = 0;
  for (let edge = 0; edge < 3; edge++) {
    const j = map.mesh.neighbors[i * 3 + edge];
    if (j < 0) continue;
    const excess =
      toUnits(map.Elevation[i] - map.Elevation[j]) - stable * map.mesh.edgeLength[i * 3 + edge];
    if (excess <= 0) continue;
    const transfer = units(Math.min(maximum, excess * response));
    if (transfer <= 0) continue;
    neighbors.push(j);
    requested.push(transfer);
    total += transfer;
    maximumExcess = Math.max(maximumExcess, excess);
  }
  if (total <= 0) return;
  let remaining = Math.min(total, units(Math.min(maximum, maximumExcess * response)));
  let remainingRequested = total;
  for (let n = 0; n < requested.length; n++) {
    const transfer =
      n === requested.length - 1
        ? remaining
        : Math.min(requested[n], Math.trunc((remaining * requested[n]) / remainingRequested));
    remaining -= transfer;
    remainingRequested -= requested[n];
    cuts[i] += transfer;
    fills[neighbors[n]] += (transfer * map.mesh.areas[i]) / map.mesh.areas[neighbors[n]];
  }
}
export function massWasting(map: PhysicalField, context: PhysicalContext, postFluvial = false) {
  const cuts = new Float64Array(map.mesh.count),
    fills = cuts.slice();
  const p = context.Profile,
    iterations = postFluvial ? p.PostFluvialMassWastingIterations : p.MassWastingIterations;
  const ratio = (p.MassWastingTransportLength / map.mesh.spacing) ** 2;
  const substeps = Math.max(1, Math.ceil(ratio));
  const response = ((p.MassWastingTransportFraction / 1000) * ratio) / substeps;
  const maximum = p.MaximumHillslopeTransport / (map.mesh.spacing * substeps);
  for (let iteration = 0; iteration < iterations * substeps; iteration++) {
    cuts.fill(0);
    fills.fill(0);
    for (let i = 0; i < cuts.length; i++)
      sourceTransfers(map, context, i, cuts, fills, response, maximum);
    let transported = 0;
    for (let i = 0; i < cuts.length; i++) {
      if (cuts[i] > 0) {
        erode(map, i, cuts[i]);
        transported += (cuts[i] / 1024) * map.mesh.areas[i];
      }
      if (fills[i] > 0) deposit(map, i, fills[i]);
    }
    map.SedimentProducedTotal += transported;
  }
}
