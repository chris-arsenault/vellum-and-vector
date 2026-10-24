// FluvialErosionLayer.cs and SedimentTransportLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, truncate, units } from "./math";
import { erode, deposit } from "./surface";
import { drainageConditioning } from "./drainageFlood";
import { resolveLandTargets } from "./flowGuidance";
import { contributingArea, sourceToOutletOrder } from "./flowGraph";
import { cellTravel, physicalDistance } from "./physicalMetric";

function recordCut(map: PhysicalField, i: number, requested: number) {
  const amount = erode(map, i, requested);
  map.CumulativeFluvialErosion[i] += amount;
  map.SedimentSupply[i] += amount;
  map.SedimentProducedTotal += (amount / 1024) * map.mesh.areas[i];
}
function controllingSill(map: PhysicalField, start: number, maximumSteps: number): number {
  let selected = -1,
    highest = -Number.MAX_VALUE,
    i = start;
  for (let distance = 0; distance < maximumSteps && i >= 0;) {
    if (map.WaterKindCodes[i] === 1) break;
    if (map.WaterKindCodes[i] === 0 && map.Elevation[i] > highest) {
      selected = i;
      highest = map.Elevation[i];
    }
    const parent = map.DrainageParents[i];
    if (parent < 0) break;
    distance += physicalDistance(map.mesh, i, parent);
    i = parent;
  }
  return selected;
}
function erodeOutlets(map: PhysicalField, c: PhysicalContext) {
  if (c.HydrologyStrength <= 0) return;
  const cuts = new Float64Array(map.mesh.count),
    p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    const overflow = map.LakeOverflow[i],
      outlet = map.LakeOutletTargets[i];
    if (overflow <= 0 || outlet < 0) continue;
    const sill = controllingSill(map, outlet, p.LakeOutletIncisionSearchDistance);
    if (sill < 0) continue;
    const incision =
      (p.MaximumLakeOutletIncisionPerPass *
        (overflow / (overflow + p.LakeOutletOverflowScale)) *
        c.HydrologyStrength) /
      1000;
    cuts[sill] = Math.max(cuts[sill], units(incision));
  }
  for (let i = 0; i < cuts.length; i++) if (cuts[i] > 0) recordCut(map, i, cuts[i]);
}
export function surfaceResistance(map: PhysicalField, i: number): number {
  const cover = clamp(map.SedimentThickness[i] / units(25), 0, 1),
    rock = Math.max(1, map.RockResistance[i]);
  // Burnt ground has lost its binding roots for the season: it gullies.
  const roots =
    (1 + map.TreeCover[i] * 1.2 + map.GrassCover[i] * 0.45 + map.WetlandCover[i] * 0.7) *
    (1 - 0.5 * map.FireActivity[i]);
  return Math.max(1, (rock + (300 - rock) * cover) * roots);
}
function erodeTriangle(
  map: PhysicalField,
  c: PhysicalContext,
  targets: Int32Array,
  area: Float64Array,
  i: number
) {
  const target = targets[i];
  // Only channels incise; leaving interfluves standing lets valleys capture neighbouring flow.
  if (target < 0 || map.WaterKindCodes[i] === 1 || area[i] < c.Profile.FluvialChannelArea) return;
  const length = Math.hypot(map.mesh.x[i] - map.mesh.x[target], map.mesh.y[i] - map.mesh.y[target]);
  const fall = Math.max(
    0,
    (map.DrainageElevations[i] - map.DrainageElevations[target]) / (1024 * length)
  );
  const catchment = area[i] / 100_000_000;
  const equilibrium = c.Profile.FluvialEquilibriumGradient / Math.max(1, catchment) ** 0.12;
  const erosiveFall = Math.max(0, fall - equilibrium);
  if (erosiveFall <= 0) return;
  const power = catchment ** 0.42 * Math.sqrt(erosiveFall) * 100;
  const cut = units(
    (Math.min(22, (power * c.Profile.FluvialErosionStrength * 1000) / surfaceResistance(map, i)) *
      c.HydrologyStrength) /
      1000
  );
  if (cut > 0) recordCut(map, i, cut);
}
export function fluvialErosion(map: PhysicalField, c: PhysicalContext) {
  if (map.AvailableFacts.has("Lakes")) erodeOutlets(map, c);
  const iterations =
    c.HydrologyStrength === 0
      ? 0
      : Math.max(1, truncate((c.Profile.FluvialErosionIterations * c.HydrologyStrength) / 1000));
  for (let iteration = 0; iteration < iterations; iteration++) {
    const pass = { ...c, Seed: c.Seed ^ iteration };
    drainageConditioning(map, pass);
    const targets = resolveLandTargets(map, pass),
      area = contributingArea(targets, map.mesh.areas);
    for (let i = 0; i < targets.length; i++) erodeTriangle(map, c, targets, area, i);
  }
}
function transportDistance(map: PhysicalField, i: number, previous: Int32Array) {
  const target = map.FlowTargets[i],
    next = target >= 0 ? target : previous[i];
  return next >= 0
    ? cellTravel(map.mesh, i, map.mesh.x[next] - map.mesh.x[i], map.mesh.y[next] - map.mesh.y[i])
    : Math.sqrt(map.mesh.areas[i]);
}
export function sedimentTransport(map: PhysicalField, c: PhysicalContext) {
  const moving = new Float64Array(map.mesh.count),
    p = c.Profile;
  const previous = new Int32Array(map.mesh.count).fill(-1);
  for (let i = 0; i < map.mesh.count; i++)
    if (map.FlowTargets[i] >= 0) previous[map.FlowTargets[i]] = i;
  for (const i of sourceToOutletOrder(map)) {
    const area = map.mesh.areas[i];
    const load = moving[i] + (map.SedimentSupply[i] / 1024) * area;
    map.SedimentSupply[i] = 0;
    if (load <= 0) continue;
    const target = map.FlowTargets[i];
    const shouldDeposit =
      map.WaterKindCodes[i] === 2 ||
      map.Slope[i] <= p.SedimentDepositionSlopeThreshold ||
      (target >= 0 && map.WaterKindCodes[target] === 1);
    const distance = transportDistance(map, i, previous);
    const capture = -Math.expm1(
      (Math.log1p(-p.SedimentTransportFraction / 1000) * distance) / p.SedimentDepositionLength
    );
    const deposited = shouldDeposit
      ? deposit(
          map,
          i,
          Math.min(units(p.MaximumSedimentDepositionPerPass), ((load * 1024) / area) * capture)
        )
      : 0;
    const volume = (deposited / 1024) * area;
    if (target >= 0) moving[target] += load - volume;
    else map.SedimentExportedTotal += load - volume;
  }
}
