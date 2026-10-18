// FluvialErosionLayer.cs and SedimentTransportLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, ratio, toUnits, truncate, units } from "./math";
import { erode, deposit } from "./surface";
import { drainageConditioning } from "./drainageFlood";
import { resolveLandTargets } from "./flowGuidance";
import { contributingArea, sourceToOutletOrder } from "./flowGraph";

function recordCut(map: PhysicalField, i: number, requested: number) {
  const amount = erode(map, i, requested);
  map.CumulativeFluvialErosion[i] += amount;
  map.SedimentSupply[i] += amount;
  map.SedimentProducedTotal += amount;
}
function controllingSill(map: PhysicalField, start: number, maximumSteps: number): number {
  let selected = -1,
    highest = -Number.MAX_VALUE,
    i = start;
  for (let step = 0; step < maximumSteps && i >= 0; step++) {
    if (map.WaterKindCodes[i] === 1) break;
    if (map.WaterKindCodes[i] === 0 && map.Elevation[i] > highest) {
      selected = i;
      highest = map.Elevation[i];
    }
    i = map.DrainageParents[i];
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
    const sill = controllingSill(map, outlet, p.LakeOutletIncisionSearchSteps);
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
  return Math.max(1, rock + (300 - rock) * cover);
}
function erodeTriangle(
  map: PhysicalField,
  c: PhysicalContext,
  targets: Int32Array,
  area: Int32Array,
  i: number
) {
  const target = targets[i];
  if (target < 0 || map.WaterKindCodes[i] === 1) return;
  const fall = Math.max(0, toUnits(map.DrainageElevations[i] - map.DrainageElevations[target]));
  const equilibrium = c.Profile.FluvialEquilibriumStep / Math.max(1, area[i]) ** 0.12;
  const erosiveFall = Math.max(0, fall - equilibrium);
  if (erosiveFall <= 0) return;
  const power = area[i] ** 0.42 * Math.sqrt(erosiveFall);
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
      area = contributingArea(targets);
    for (let i = 0; i < targets.length; i++) erodeTriangle(map, c, targets, area, i);
  }
}
export function sedimentTransport(map: PhysicalField, c: PhysicalContext) {
  const moving = new Float64Array(map.mesh.count),
    p = c.Profile;
  for (const i of sourceToOutletOrder(map)) {
    const load = moving[i] + map.SedimentSupply[i];
    map.SedimentSupply[i] = 0;
    if (load <= 0) continue;
    const target = map.FlowTargets[i];
    const shouldDeposit =
      map.WaterKindCodes[i] === 2 ||
      map.Slope[i] <= units(p.SedimentDepositionSlopeThreshold) ||
      (target >= 0 && map.WaterKindCodes[target] === 1);
    const deposited = shouldDeposit
      ? deposit(
          map,
          i,
          Math.min(
            units(p.MaximumSedimentDepositionPerPass),
            Math.max(1, ratio(load, p.SedimentTransportFraction, 1000))
          )
        )
      : 0;
    if (target >= 0) moving[target] += load - deposited;
    else map.SedimentExportedTotal += load - deposited;
  }
}
