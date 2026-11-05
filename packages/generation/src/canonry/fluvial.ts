import { meshDeltaX } from "./mesh";
// FluvialErosionLayer.cs and SedimentTransportLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, truncate, units } from "./math";
import { rockKindOfCode } from "../rock/rockCatalogue";
import { erode, deposit } from "./surface";
import { drainageConditioning } from "./drainageFlood";
import { resolveLandTargets } from "./flowGuidance";
import { contributingArea, sourceToOutletOrder } from "./flowGraph";
import { cellTravel, physicalDistance } from "./physicalMetric";
import type { Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";

/** How much of a cell a river's valley covers: wider with its catchment, all of a small cell. */
export const valleyShare = (widthShare: number, catchmentArea: number, cellArea: number) =>
  clamp((widthShare * Math.sqrt(catchmentArea)) / Math.sqrt(cellArea), 0, 1);
/**
 * A channel cut to `depth` across `share` of the cell. A cell's height is the mean of its ground, so
 * that mean falls by the depth over that share only; the depth itself is remembered as incision.
 */
export function recordCut(map: PhysicalField, i: number, depth: number, share = 1) {
  const amount = erode(map, i, Math.round(depth * share));
  map.CumulativeFluvialErosion.add(i, depth);
  map.SedimentSupply.add(i, amount);
  map.SedimentProducedTotal += (amount / 1024) * map.mesh.area(i);
}
function controllingSill(map: PhysicalField, start: number, maximumSteps: number): number {
  let selected = -1,
    highest = -Number.MAX_VALUE,
    i = start;
  for (let distance = 0; distance < maximumSteps && i >= 0;) {
    const water = map.WaterKindCodes.get(i);
    if (water === 1) break;
    if (water === 0 && map.Elevation.get(i) > highest) {
      selected = i;
      highest = map.Elevation.get(i);
    }
    const parent = map.DrainageParents.get(i);
    if (parent < 0) break;
    distance += physicalDistance(map.mesh, i, parent);
    i = parent;
  }
  return selected;
}
function erodeOutlets(map: PhysicalField, c: PhysicalContext) {
  if (c.HydrologyStrength <= 0) return;
  const cuts = workingArray(map, "float64", "fluvial:outlet-cuts"),
    p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    const overflow = map.LakeOverflow.get(i),
      outlet = map.LakeOutletTargets.get(i);
    if (overflow <= 0 || outlet < 0) continue;
    const sill = controllingSill(map, outlet, p.LakeOutletIncisionSearchDistance);
    if (sill < 0) continue;
    const incision =
      (p.MaximumLakeOutletIncisionPerPass *
        (overflow / (overflow + p.LakeOutletOverflowScale)) *
        c.HydrologyStrength) /
      1000;
    cuts.set(sill, Math.max(cuts.get(sill), units(incision)));
  }
  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts.get(i);
    if (cut > 0) recordCut(map, i, cut);
  }
  releaseWorking(map, cuts);
}
export function surfaceResistance(map: PhysicalField, i: number): number {
  const cover = clamp(map.SedimentThickness.get(i) / units(25), 0, 1),
    rock = Math.max(1, map.RockResistance.get(i));
  // Burnt ground has lost its binding roots for the season: it gullies.
  const roots =
    (1 +
      map.TreeCover.get(i) * 1.2 +
      map.GrassCover.get(i) * 0.45 +
      map.WetlandCover.get(i) * 0.7) *
    (1 - 0.5 * map.FireActivity.get(i));
  return Math.max(1, (rock + (300 - rock) * cover) * roots);
}
function erodeTriangle(
  map: PhysicalField,
  c: PhysicalContext,
  targets: Band,
  area: Band,
  i: number
) {
  const target = targets.get(i);
  // Only channels incise; leaving interfluves standing lets valleys capture neighbouring flow.
  if (target < 0 || map.WaterKindCodes.get(i) === 1 || area.get(i) < c.Profile.FluvialChannelArea)
    return;
  const length = Math.hypot(
    meshDeltaX(map.mesh, map.mesh.x(i) - map.mesh.x(target)),
    map.mesh.y(i) - map.mesh.y(target)
  );
  const fall = Math.max(
    0,
    (map.DrainageElevations.get(i) - map.DrainageElevations.get(target)) / (1024 * length)
  );
  const catchment = area.get(i) / 100_000_000;
  const equilibrium = c.Profile.FluvialEquilibriumGradient / Math.max(1, catchment) ** 0.12;
  const erosiveFall = Math.max(0, fall - equilibrium);
  if (erosiveFall <= 0) return;
  // Stream power: water and slope together, so a trunk on steep ground cuts far more than either.
  const power =
    catchment ** c.Profile.FluvialAreaExponent * erosiveFall * c.Profile.FluvialPowerScale;
  // A river's limit is how much it can carry; the rock then decides how much of that it can cut.
  const requested = units(
    (((Math.min(c.Profile.MaximumFluvialCutPerIteration, power * c.Profile.FluvialErosionStrength) *
      1000) /
      surfaceResistance(map, i)) *
      c.HydrologyStrength) /
      1000
  );
  // A river cuts down to what it runs into, and sea level is the base level beneath everything.
  const cut = Math.min(
    requested,
    units(erosiveFall * length),
    map.Elevation.get(i) - (map.EffectiveSeaLevel + units(1))
  );
  if (cut > 0)
    recordCut(
      map,
      i,
      cut,
      valleyShare(c.Profile.FluvialValleyWidthShare, area.get(i), map.mesh.area(i))
    );
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
      area = contributingArea(map, targets);
    for (let i = 0; i < targets.length; i++) erodeTriangle(map, c, targets, area, i);
    releaseWorking(map, targets, area);
  }
  dissolveRock(map, c);
}
/** The runoff at which water takes all the soluble rock it can on a pass. */
const fullRunoff = 1000;
/** Water takes soluble rock wherever it runs, valley or not: limestone, salt, tufa all go this way. */
function dissolveRock(map: PhysicalField, c: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) === 1) continue;
    const soluble = rockKindOfCode(map.RockKindCodes.get(i)).solubility,
      wet = clamp(map.Runoff.get(i) / fullRunoff, 0, 1),
      cut = units((c.Profile.DissolvedPerPass * soluble * wet * c.HydrologyStrength) / 1000),
      above = map.Elevation.get(i) - (map.EffectiveSeaLevel + units(1));
    if (cut > 0 && above > 0) recordCut(map, i, Math.min(cut, above));
  }
}
function transportDistance(map: PhysicalField, i: number, previous: Band) {
  const target = map.FlowTargets.get(i),
    next = target >= 0 ? target : previous.get(i);
  return next >= 0
    ? cellTravel(
        map.mesh,
        i,
        meshDeltaX(map.mesh, map.mesh.x(next) - map.mesh.x(i)),
        map.mesh.y(next) - map.mesh.y(i)
      )
    : Math.sqrt(map.mesh.area(i));
}
export function sedimentTransport(map: PhysicalField, c: PhysicalContext) {
  const moving = workingArray(map, "float64", "sediment:moving"),
    p = c.Profile;
  const previous = workingArray(map, "int32", "sediment:previous").fill(-1);
  for (let i = 0; i < map.mesh.count; i++) {
    const target = map.FlowTargets.get(i);
    if (target >= 0) previous.set(target, i);
  }
  const order = sourceToOutletOrder(map);
  for (let n = 0; n < order.length; n++) {
    const i = order.get(n),
      area = map.mesh.area(i);
    const load = moving.get(i) + (map.SedimentSupply.get(i) / 1024) * area;
    map.SedimentSupply.set(i, 0);
    if (load <= 0) continue;
    const target = map.FlowTargets.get(i);
    const shouldDeposit =
      map.WaterKindCodes.get(i) === 2 ||
      map.Slope.get(i) <= p.SedimentDepositionSlopeThreshold ||
      (target >= 0 && map.WaterKindCodes.get(target) === 1);
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
    if (target >= 0) moving.add(target, load - volume);
    else map.SedimentExportedTotal += load - volume;
  }
  releaseWorking(map, order, moving, previous);
}
