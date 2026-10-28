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
import { constructionWeight, crossSection, summitVariation } from "./orogenicShape";
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
import { adjustCrustColumn } from "./crustTransport";
import { distributeOrogenicRoots } from "./orogenicRoots";
import type { Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";

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
  const maximum = c.code === 1 ? 1.55 : c.code === 2 ? 0.55 : c.code === 3 ? 0.2 : 1;
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
  const crest = clamp(section / 1.55, 0, 1);
  const requested = units(
    Math.min(
      p.MaximumOrogenicSurfaceReliefPerPass,
      ((value * p.OrogenicSurfaceReliefSharePerMille) / 1000) *
        (0.38 + Math.sqrt(crest) * 0.62) *
        summitVariation(map, context, c, i, source)
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
  const influence = clamp((Math.sqrt(crest) * (c.prominence / 1000)) / 1.75, 0, 1);
  map.RockResistance.set(
    i,
    Math.max(
      map.RockResistance.get(i),
      round(1000 + (p.OrogenicCoreRockResistance - 1000) * influence)
    )
  );
  rebuild(map, i);
}
function constructTriangle(
  map: PhysicalField,
  context: PhysicalContext,
  c: BoundaryComponent,
  frame: OrogenicFrame,
  i: number,
  step: number,
  roots: Band | null
) {
  const source = frame.source.get(i),
    section = crossSection(map, context, c, i, source, frame.distance.get(i), frame.side.get(i));
  const weight = constructionWeight(map, context, c, frame, i, section);
  const drive = step * (c.prominence / 1000) * weight;
  if (!roots && Math.abs(drive) < 0.5) return;
  const admitted = roots ? roots.get(i) : changeThickness(map, context, c, i, section, drive);
  map.OrogenicConstruction.set(i, admitted);
  recordActivity(map, context, i, admitted);
  constructSurface(map, context, c, i, source, section, admitted);
}
export function orogenicConstruction(map: PhysicalField, context: PhysicalContext) {
  map.OrogenicComponentIds.fill(-1);
  map.OrogenicSystemProminence.fill(0);
  map.OrogenicConstruction.fill(0);
  const ids = workingArray(map, "int32", "orogeny:components").fill(-1);
  const components = discoverComponents(map, context, ids);
  rankComponents(components, context);
  const frame = propagateInfluence(map, context, components, ids);
  const step = context.IsEvolutionEpoch
    ? (context.Profile.EpochOrogenicConstructionStep * context.TectonicStrength) / 1000
    : context.Profile.InitialOrogenicConstructionStep;
  if (step <= 0) {
    releaseWorking(map, ids, frame.distance, frame.source, frame.side);
    return;
  }
  const roots = context.IsEvolutionEpoch
    ? distributeOrogenicRoots(map, context, components, frame)
    : null;
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds.get(i);
    if (id >= 0) constructTriangle(map, context, components[id], frame, i, step, roots);
  }
  releaseWorking(map, ids, frame.distance, frame.source, frame.side, ...(roots ? [roots] : []));
}
