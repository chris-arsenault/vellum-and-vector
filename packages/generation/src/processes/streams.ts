// FluvialErosionLayer.cs, Canonry 0f62584c.
import type { Band } from "@atlas/domain";
import { contributingArea } from "../canonry/flowGraph";
import { drainageConditioning } from "../canonry/drainageFlood";
import { resolveLandTargets } from "../canonry/flowGuidance";
import type { PhysicalField } from "../canonry/field";
import { clamp, truncate, units } from "../canonry/math";
import { meshDeltaX } from "../canonry/mesh";
import { physicalDistance } from "../canonry/physicalMetric";
import { releaseWorking, workingArray } from "../canonry/physicalNumerics";
import { recordCut, wearAway } from "../rock/groundLedger";
import { compileMix } from "../rock/modes";
import type { GroundProcess, ProcessWork } from "./groundProcess";
import { streamSettings } from "./streamSettings";

/** Flowing water grinds with what it carries. */
const flowing = compileMix({ abrasion: 1 });

/** How much of a cell a river's valley covers: wider with its catchment, all of a small cell. */
export const valleyShare = (widthShare: number, catchmentArea: number, cellArea: number) =>
  clamp((widthShare * Math.sqrt(catchmentArea)) / Math.sqrt(cellArea), 0, 1);

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
function cutOutlets({ map, context: c, settings: p }: ProcessWork) {
  if (c.HydrologyStrength <= 0) return;
  const cuts = workingArray(map, "float64", "fluvial:outlet-cuts");
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
/** How steeply the water at a cell falls beyond the slope its catchment grades to, and how far. */
function erosiveFall({ map, settings: p }: ProcessWork, target: number, area: number, i: number) {
  const length = Math.hypot(
      meshDeltaX(map.mesh, map.mesh.x(i) - map.mesh.x(target)),
      map.mesh.y(i) - map.mesh.y(target)
    ),
    fall = Math.max(
      0,
      (map.DrainageElevations.get(i) - map.DrainageElevations.get(target)) / (1024 * length)
    ),
    catchment = area / 100_000_000,
    equilibrium = p.FluvialEquilibriumGradient / Math.max(1, catchment) ** 0.12;
  return { catchment, length, steep: Math.max(0, fall - equilibrium) };
}
function cutCell(work: ProcessWork, targets: Band, area: Band, i: number) {
  const { map, context: c, settings: p, ground } = work,
    target = targets.get(i);
  if (target < 0 || map.WaterKindCodes.get(i) === 1) return;
  const { catchment, length, steep } = erosiveFall(work, target, area.get(i), i);
  if (steep <= 0) return;
  // Stream power: water and slope together, so a trunk on steep ground cuts far more than either.
  const power = catchment ** p.FluvialAreaExponent * steep * p.FluvialPowerScale;
  // A river's limit is how much it can carry; the ground then decides how much of that it gives up.
  // A river cuts down to what it runs into, and sea level is the base level beneath everything.
  const cut = ground.actOn(
    i,
    flowing,
    (Math.min(p.MaximumFluvialCutPerIteration, power * p.FluvialErosionStrength) *
      c.HydrologyStrength) /
      1000,
    Math.min(units(steep * length), map.Elevation.get(i) - (map.EffectiveSeaLevel + units(1)))
  );
  if (cut <= 0) return;
  // A big valley covers a share by its catchment; streams too fine to map cover a share of their
  // own. Ground that gives up easily lets either widen, and strong ground keeps it narrow.
  const reach = Math.max(
      p.FluvialDissectionShare,
      valleyShare(p.FluvialValleyWidthShare, area.get(i), map.mesh.area(i))
    ),
    share = Math.min(1, reach * ground.gives(i, flowing));
  if (area.get(i) >= p.FluvialChannelArea) recordCut(map, i, cut, share);
  else wearAway(map, i, Math.round(cut * share));
}
export const streams: GroundProcess = {
  id: "streams",
  statement:
    "Water falling beyond the slope its catchment grades to cuts every cell by its power. Catchments big enough leave a valley on record; smaller streams only wear the land down.",
  settings: streamSettings,
  atScale(settings, { scale }) {
    const finer = scale < 1;
    return {
      FluvialChannelArea:
        settings.FluvialChannelArea *
        scale *
        scale *
        (finer ? settings.FluvialFineChannelShare : 1),
      FluvialEquilibriumGradient:
        settings.FluvialEquilibriumGradient * (finer ? settings.FluvialFineGradientShare : 1),
    };
  },
  run(work) {
    const { map, context: c, settings: p } = work;
    if (map.AvailableFacts.has("Lakes")) cutOutlets(work);
    const iterations =
      c.HydrologyStrength === 0
        ? 0
        : Math.max(1, truncate((p.FluvialErosionIterations * c.HydrologyStrength) / 1000));
    for (let iteration = 0; iteration < iterations; iteration++) {
      const pass = { ...c, Seed: c.Seed ^ iteration };
      drainageConditioning(map, pass);
      const targets = resolveLandTargets(map, pass),
        area = contributingArea(map, targets);
      for (let i = 0; i < targets.length; i++) cutCell(work, targets, area, i);
      releaseWorking(map, targets, area);
    }
  },
};
