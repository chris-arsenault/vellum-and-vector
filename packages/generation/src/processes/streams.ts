// FluvialErosionLayer.cs, Canonry 0f62584c.
import type { Band } from "@atlas/domain";
import { waterGathered } from "../canonry/flowGraph";
import { drainageConditioning } from "../canonry/drainageFlood";
import { resolveLandTargets } from "../canonry/flowGuidance";
import { clamp, units } from "../canonry/math";
import { meshDeltaX } from "../canonry/mesh";
import { physicalDistance } from "../canonry/physicalMetric";
import { releaseWorking, workingArray } from "../canonry/physicalNumerics";
import type { WearCause } from "../coupling/wearStage";
import { compileMix } from "../rock/modes";
import { defineProcess, type ProcessWork } from "./groundProcess";
import { streamSettings } from "./streamSettings";

/** Flowing water grinds with what it carries. */
const flowing = compileMix({ abrasion: 1 });
const cutting: WearCause = { id: "streams", remembers: "CumulativeFluvialErosion" };

/** How much of a cell a river's valley covers: wider with its catchment, all of a small cell. */
export const valleyShare = (widthShare: number, catchmentArea: number, cellArea: number) =>
  clamp((widthShare * Math.sqrt(catchmentArea)) / Math.sqrt(cellArea), 0, 1);

const reads = [
  "WaterKindCodes",
  "Elevation",
  "DrainageParents",
  "DrainageElevations",
  "LakeOverflow",
  "LakeOutletTargets",
] as const;
type StreamWork = ProcessWork<(typeof reads)[number]>;

function controllingSill({ field }: StreamWork, start: number, maximumSteps: number): number {
  let selected = -1,
    highest = -Number.MAX_VALUE,
    i = start;
  for (let distance = 0; distance < maximumSteps && i >= 0;) {
    const water = field.WaterKindCodes.get(i);
    if (water === 1) break;
    if (water === 0 && field.Elevation.get(i) > highest) {
      selected = i;
      highest = field.Elevation.get(i);
    }
    const parent = field.DrainageParents.get(i);
    if (parent < 0) break;
    distance += physicalDistance(field.mesh, i, parent);
    i = parent;
  }
  return selected;
}
/** Overflowing lakes cut their outlets, by how much water goes over the sill. */
function cutOutlets(work: StreamWork) {
  const { field, context: c, settings: p, world, span, wear } = work;
  if (c.HydrologyStrength <= 0) return;
  const cuts = workingArray(world, "float64", "fluvial:outlet-cuts");
  for (let i = 0; i < field.mesh.count; i++) {
    const overflow = field.LakeOverflow.get(i),
      outlet = field.LakeOutletTargets.get(i);
    if (overflow <= 0 || outlet < 0) continue;
    const sill = controllingSill(work, outlet, p.LakeOutletIncisionSearchDistance);
    if (sill < 0) continue;
    const incision =
      (p.LakeOutletIncisionPerSpan *
        span *
        (overflow / (overflow + p.LakeOutletOverflowScale)) *
        c.HydrologyStrength) /
      1000;
    cuts.set(sill, Math.max(cuts.get(sill), units(incision)));
  }
  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts.get(i);
    if (cut > 0) wear.demand(cutting, i, cut, cut);
  }
  releaseWorking(world, cuts);
  wear.settle();
}
/** How steeply the water at a cell falls beyond the slope its catchment grades to, and how far. */
function erosiveFall({ field, settings: p }: StreamWork, target: number, water: number, i: number) {
  const length = Math.hypot(
      meshDeltaX(field.mesh, field.mesh.x(i) - field.mesh.x(target)),
      field.mesh.y(i) - field.mesh.y(target)
    ),
    fall = Math.max(
      0,
      (field.DrainageElevations.get(i) - field.DrainageElevations.get(target)) / (1024 * length)
    ),
    catchment = water / 100_000_000,
    equilibrium = p.FluvialEquilibriumGradient / Math.max(1, catchment) ** 0.12;
  return { catchment, length, steep: Math.max(0, fall - equilibrium) };
}
function cutCell(work: StreamWork, targets: Band, water: Band, i: number, perStep: number) {
  const { field, context: c, settings: p, ground, wear } = work,
    target = targets.get(i);
  if (target < 0 || field.WaterKindCodes.get(i) === 1) return;
  const { catchment, length, steep } = erosiveFall(work, target, water.get(i), i);
  if (steep <= 0) return;
  // Stream power: water and slope together, so a trunk on steep ground cuts far more than either.
  const power =
    catchment ** p.FluvialAreaExponent * steep * p.FluvialPowerScale * p.FluvialErosionRate;
  // The ground decides how much of that it gives up, and no step cuts past the fall that drives it,
  // since a river cannot cut below what it flows into.
  const cut = ground.actOn(
    i,
    flowing,
    (power * perStep * c.HydrologyStrength) / 1000,
    units(steep * length)
  );
  if (cut <= 0) return;
  // A big valley covers a share by its catchment; streams too fine to map cover a share of their
  // own. Ground that gives up easily lets either widen, and strong ground keeps it narrow.
  const reach = Math.max(
      p.FluvialDissectionShare,
      valleyShare(p.FluvialValleyWidthShare, water.get(i), field.mesh.area(i))
    ),
    share = Math.min(1, reach * ground.gives(i, flowing));
  wear.demand(cutting, i, cut * share, water.get(i) >= p.FluvialChannelArea ? cut : 0);
}
export const streams = defineProcess({
  id: "streams",
  statement:
    "Water falling beyond the slope its catchment grades to cuts every cell by the power it carries, so wet ground and big rivers cut most.",
  reads,
  asks: ["runoff"],
  moves: [
    ["rock", "load"],
    ["loose", "load"],
  ],
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
    const { field, context: c, settings: p, world, span, ask, wear } = work;
    if (world.AvailableFacts.has("Lakes")) cutOutlets(work);
    if (c.HydrologyStrength === 0) return;
    // Steps are how finely the work is resolved. How much gets done is the rate and the span.
    const steps = p.FluvialErosionSteps,
      perStep = span / steps,
      runoff = ask("runoff");
    for (let step = 0; step < steps; step++) {
      const pass = { ...c, Seed: c.Seed ^ step };
      drainageConditioning(world, pass);
      const targets = resolveLandTargets(world, pass),
        water = waterGathered(world, targets, runoff);
      for (let i = 0; i < field.mesh.count; i++) cutCell(work, targets, water, i, perStep);
      wear.settle();
      releaseWorking(world, targets, water);
    }
  },
});
