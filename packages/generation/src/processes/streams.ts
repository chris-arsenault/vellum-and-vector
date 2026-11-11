import { MapScale, type Band } from "@atlas/domain";
import type { PhysicalContext } from "../world/context";
import { drainageFlood } from "./waterProcesses";
import { readOperation } from "../processOperation";
import { resolveLandTargets } from "../world/flowGuidance";
import { waterGathered } from "../world/flowGraph";
import { referenceWaterPassage } from "../world/waterQuantity";
import { clamp, units } from "../world/math";
import { meshDeltaX } from "../world/mesh";
import type { WearCause } from "../coupling/stage";
import { compileMix } from "../rock/modes";
import { defineProcess, type ProcessWork } from "./groundProcess";
import { streamSettings } from "./streamSettings";

/** Flowing water grinds with what it carries. */
const flowing = compileMix({ abrasion: 1 });
const cutting: WearCause = { id: "streams", remembers: "CumulativeFluvialErosion" };

/** How much of a cell a river's valley covers: wider with its catchment, all of a small cell. */
export const valleyShare = (widthShare: number, catchmentArea: number, cellArea: number) =>
  clamp((widthShare * Math.sqrt(catchmentArea)) / Math.sqrt(cellArea), 0, 1);

const reads = ["WaterKindCodes", "Elevation", "DrainageElevations"] as const;
type StreamWork = ProcessWork<(typeof reads)[number]>;

/** How steeply the water at a cell falls beyond the slope its catchment grades to, and how far. */
function erosiveFall({ field, settings: p }: StreamWork, target: number, water: number, i: number) {
  const length = Math.hypot(
      meshDeltaX(field.mesh, field.mesh.x(i) - field.mesh.x(target)),
      field.mesh.y(i) - field.mesh.y(target)
    ),
    fall = Math.max(
      0,
      MapScale.metres(
        field.DrainageElevations.get(i) - field.DrainageElevations.get(target),
        "native"
      ) / length
    ),
    catchment = water / field.scale.area(0.00000625),
    equilibrium = p.FluvialEquilibriumGradient / Math.max(1, catchment) ** 0.12;
  return { catchment, length, steep: Math.max(0, fall - equilibrium) };
}
function cutCell(work: StreamWork, targets: Band, water: Band, i: number, perStep: number) {
  const { field, context: c, settings: p, ground, stage } = work,
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
    units(steep * length),
    "cut",
    [
      meshDeltaX(field.mesh, field.mesh.x(target) - field.mesh.x(i)),
      field.mesh.y(target) - field.mesh.y(i),
    ]
  );
  if (cut <= 0) return;
  // A big valley covers a share of the cell by its catchment; streams too fine to map cover a share
  // of their own. The ground has already said how deep the water gets: strength counts once.
  const share = valleyShare(p.FluvialValleyWidthShare, water.get(i), field.mesh.area(i));
  stage.cut(cutting, i, cut, share, water.get(i) >= p.FluvialChannelArea);
}
export const streams = defineProcess({
  id: "streams",
  statement:
    "Water falling beyond the slope its catchment grades to cuts every cell by the power it carries, so wet ground and big rivers cut most.",
  reads,
  needs: ["Elevation", "WaterKindCodes", "RockKindCodes"],
  provides: ["Elevation", "BedrockElevation", "SedimentSupply"],
  asks: ["discharge", "rootHold"],
  moves: [
    ["rock", "load"],
    ["loose", "load"],
  ],
  settings: streamSettings,
  prepare: (map) => ({
    conditionDrainage: (context: PhysicalContext) =>
      readOperation(map, drainageFlood.operation, { map, context }),
    landTargets: (context: PhysicalContext) => resolveLandTargets(map, context),
    waterGathered: (targets: Band, rain: Pick<Band, "get">, context: PhysicalContext) =>
      waterGathered(map, targets, rain, referenceWaterPassage(map, context)),
  }),
  forExecution(settings, { refined }) {
    return {
      FluvialChannelArea:
        settings.FluvialChannelArea * (refined ? settings.FluvialFineChannelShare : 1),
      FluvialEquilibriumGradient:
        settings.FluvialEquilibriumGradient * (refined ? settings.FluvialFineGradientShare : 1),
    };
  },
  // Substeps are how finely the work is resolved; how much gets done is the rate and the span.
  substeps: (p, span) => p.FluvialErosionStepsPerSpan * span,
  execute(work) {
    const { field, context: c, tools, span, substep, ask } = work;
    if (c.HydrologyStrength === 0) return;
    // A lake's water falls over its sill like any river's, so its outlet cuts by what comes through
    // and the fall there, in whatever ground it crosses.
    const pass = { ...c, Seed: c.Seed ^ substep };
    tools.conditionDrainage(pass);
    const targets = tools.landTargets(pass),
      water = tools.waterGathered(targets, ask("discharge"), c);
    for (let i = 0; i < field.mesh.count; i++) cutCell(work, targets, water, i, span);
    tools.release(targets, water);
  },
});
