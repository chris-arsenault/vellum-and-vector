// OrogenicConstructionLayer finite deformation and constructed summit rock, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import {
  discoverComponents,
  propagateInfluence,
  rankComponents,
  type BoundaryComponent,
  type OrogenicFrame,
} from "./orogenicComponents";
import {
  constructionWeight,
  crossSection,
  orogenicCrestSection,
  summitVariation,
} from "./orogenicShape";
import {
  buoyancy,
  clamp,
  crustHeight,
  elevationLimit,
  round,
  thickness,
  toUnits,
  units,
} from "./math";
import { rebuild } from "./surface";
import { stripRock } from "../rock/rockColumn";
import { adjustCrustColumn } from "./crustTransport";
import { crustFlow, distributeOrogenicRoots, pileUpEarlierShortening } from "./orogenicRoots";
import { advanceThrustFronts, slipThrustSheets } from "./orogenicSheets";
import { sutureReactivation } from "./reactivation";
import type { Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";

/**
 * How much rock a crest's rise brings up, for each metre it stands higher. Ranges lose far more rock
 * than they keep as height, so the deep rock of a belt's core reaches the surface.
 */
const thrustExhumation = 4;
function deformationLimit(
  context: PhysicalContext,
  c: BoundaryComponent,
  fraction: number,
  section: number,
  drive: number
): number {
  const p = context.Profile,
    foundation = 1000 + 3000 * fraction;
  if (drive < 0)
    return foundation - p.ContinentalRiftThinningBudget * clamp(Math.abs(section) / 0.76, 0, 1);
  const prominence = clamp(
    (c.prominence - p.OrogenicProminenceMinimum) /
      Math.max(1, p.OrogenicProminenceMaximum - p.OrogenicProminenceMinimum),
    0,
    1
  );
  const root =
    p.OrogenicRootBudgetMinimum +
    (p.OrogenicRootBudgetMaximum - p.OrogenicRootBudgetMinimum) * prominence;
  const maximum = c.code === 2 ? 0.55 : c.code === 3 ? 0.2 : 1;
  return foundation + root * clamp(section / maximum, 0, 1);
}
function changeThickness(
  map: PhysicalField,
  context: PhysicalContext,
  c: BoundaryComponent,
  i: number,
  section: number,
  drive: number
): number {
  const fraction = map.CrustContinentalFraction.get(i) / 1000,
    current = toUnits(map.CrustThickness.get(i));
  const requested = current + drive / (buoyancy(fraction) / 1000);
  const limit = deformationLimit(context, c, fraction, section, drive);
  const next = thickness(
    drive > 0
      ? Math.min(requested, Math.max(current, limit))
      : Math.max(requested, Math.min(current, limit))
  );
  adjustCrustColumn(map, i, units(next));
  return units(crustHeight(next, fraction) - crustHeight(current, fraction));
}
function recordActivity(map: PhysicalField, context: PhysicalContext, i: number, admitted: number) {
  const value = toUnits(admitted);
  map.TectonicActivityHistory.set(
    i,
    Math.min(2147483647, map.TectonicActivityHistory.get(i) + Math.abs(value))
  );
  if (value <= 0) return;
  const uplift = value / Math.max(1, context.Profile.InitialOrogenicConstructionStep);
  map.Uplift.set(i, Math.max(map.Uplift.get(i), clamp(uplift, 0, 1.5)));
  map.RidgeInfluence.set(i, Math.max(map.RidgeInfluence.get(i), clamp(uplift * 1.3, 0, 1)));
}
function constructSurface(
  map: PhysicalField,
  context: PhysicalContext,
  c: BoundaryComponent,
  i: number,
  source: number,
  section: number,
  admitted: number
) {
  const value = toUnits(admitted),
    p = context.Profile;
  if (value <= 0 || map.CrustContinentalFraction.get(i) / 1000 < 0.35 || c.code !== 1) return;
  const crest = clamp(section / orogenicCrestSection, 0, 1),
    structural = ((value * p.OrogenicSurfaceReliefSharePerMille) / 1000) * (0.2 + crest * 0.8);
  const requested = units(
    Math.min(
      p.MaximumOrogenicSurfaceReliefPerPass,
      structural * summitVariation(map, context, c, i, source)
    )
  );
  if (requested <= 0) return;
  const old = map.BedrockElevation.get(i);
  const next = clamp(
    old + requested,
    units(-elevationLimit),
    units(elevationLimit) - map.SedimentThickness.get(i)
  );
  const applied = next - old;
  if (applied <= 0) return;
  map.BedrockElevation.set(i, next);
  map.SurfaceRockLoad.add(i, applied);
  // A sheet's leading edge brings up what it was cut from, so a belt's core shows older rock. How
  // much follows the belt's structure, not the height of one summit, so rock lines up along it.
  stripRock(map, i, units(structural * crest * thrustExhumation));
  rebuild(map, i);
}
function constructTriangle(
  map: PhysicalField,
  context: PhysicalContext,
  c: BoundaryComponent,
  frame: OrogenicFrame,
  i: number,
  step: number,
  roots: Band
) {
  const source = frame.source.get(i),
    section = crossSection(map, context, c, frame, i);
  const weight = constructionWeight(map, context, c, frame, i, section);
  const drive = step * (c.prominence / 1000) * weight;
  // Only a convergent belt draws on the crust the plates piled up; anything else moves on its own.
  const fedByRoots = c.code === 1;
  if (!fedByRoots && Math.abs(drive) < 0.5) return;
  const admitted = fedByRoots ? roots.get(i) : changeThickness(map, context, c, i, section, drive);
  map.OrogenicConstruction.set(i, admitted);
  recordActivity(map, context, i, admitted);
  recordGrain(map, c, i, source, section, admitted);
  constructSurface(map, context, c, i, source, section, admitted);
}
/**
 * Constructed relief remembers the strike that organized it. The grain is the boundary's
 * tangent as a doubled-angle axis, weighted by how much of the belt's cross-section built
 * this cell; a stronger later construction replaces a weaker earlier one, and the crust
 * carries the result away from the boundary.
 */
function recordGrain(
  map: PhysicalField,
  c: BoundaryComponent,
  i: number,
  source: number,
  section: number,
  admitted: number
) {
  if (toUnits(admitted) <= 0 || c.code !== 1) return;
  const tx = map.TectonicTangentX.get(source) / 1000,
    ty = map.TectonicTangentY.get(source) / 1000,
    length = Math.hypot(tx, ty);
  if (length < 0.01) return;
  const coherence = clamp(section / 0.9, 0, 1) * clamp(c.prominence / 1500, 0.4, 1),
    existing = Math.hypot(map.StructuralGrainX.get(i), map.StructuralGrainY.get(i)) / 1000;
  if (coherence <= existing) return;
  const ux = tx / length,
    uy = ty / length;
  map.StructuralGrainX.set(i, round((ux * ux - uy * uy) * coherence * 1000));
  map.StructuralGrainY.set(i, round(2 * ux * uy * coherence * 1000));
}
export function orogenicConstruction(map: PhysicalField, context: PhysicalContext) {
  map.OrogenicComponentIds.fill(-1);
  map.OrogenicSystemProminence.fill(0);
  map.OrogenicConstruction.fill(0);
  const ids = workingArray(map, "int32", "orogeny:components").fill(-1);
  const components = discoverComponents(map, context, ids);
  rankComponents(components, context);
  const frame = propagateInfluence(map, context, components, ids);
  advanceThrustFronts(map, context, components, frame);
  slipThrustSheets(map, context, components, frame);
  const step = context.IsEvolutionEpoch
    ? (context.Profile.EpochOrogenicConstructionStep * context.TectonicStrength) / 1000
    : context.Profile.InitialOrogenicConstructionStep;
  const frameBands = [frame.distance, frame.source, frame.side, frame.reach, frame.overlap];
  if (step <= 0) {
    releaseWorking(map, ids, ...frameBands);
    return;
  }
  if (!context.IsEvolutionEpoch) pileUpEarlierShortening(map, context);
  const roots = distributeOrogenicRoots(map, context, components, frame);
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds.get(i);
    if (id >= 0) constructTriangle(map, context, components[id], frame, i, step, roots);
  }
  if (context.IsEvolutionEpoch) sutureReactivation(map, context);
  crustFlow(map, context, (i) => {
    const id = map.OrogenicComponentIds.get(i);
    return id >= 0 && components[id].code === 1;
  });
  releaseWorking(map, ids, ...frameBands, roots);
}
