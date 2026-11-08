// OrogenicConstructionLayer finite deformation and constructed summit rock, Canonry 0f62584c.
import { crustForming, type PhysicalField } from "./field";
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
  crustPerRock,
  thickness,
  toUnits,
  units,
} from "./math";
import { raiseFromCrust } from "../rock/groundLedger";
import { deformGround } from "../rock/groundDeformation";
import { adjustCrustColumn } from "../rock/crustTransport";
import { crustFlow, distributeOrogenicRoots, pileUpEarlierShortening } from "./orogenicRoots";
import { advanceThrustFronts, climbThrustRamps, inBelt, slipThrustSheets } from "./orogenicSheets";
import { sutureReactivation } from "./reactivation";
import type { Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";

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
  const next = thickness(current + drive / (buoyancy(fraction) / 1000));
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
    fraction = map.CrustContinentalFraction.get(i) / 1000,
    // Of the crust that reached this column, this share stands up as rock and the rest stays as root.
    rockFromCrust =
      (value / (buoyancy(fraction) / 1000) / crustPerRock(fraction)) * p.OrogenicRockShare,
    structural = rockFromCrust * (0.2 + crest * 0.8);
  const requested = units(structural * summitVariation(map, context, c, i, source));
  if (requested <= 0) return;
  // What stands up was the crust's: a belt builds height by moving what it has, not from nothing.
  raiseFromCrust(map, i, requested, "mountains");
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
 * Construction strains the surviving beds toward the boundary's doubled-angle tangent.
 * Earlier and later fabric mix according to the strain reaching each bed; transport carries
 * the resulting material structure away from the boundary.
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
  const coherence = clamp(section / 0.9, 0, 1) * clamp(c.prominence / 1500, 0.4, 1);
  deformGround(map, i, tx, ty, coherence, admitted);
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
  const climb = slipThrustSheets(map, context, components, frame);
  const forming = crustForming(map),
    step = forming
      ? context.Profile.InitialOrogenicConstructionStep
      : (context.Profile.EpochOrogenicConstructionStep * context.Span * context.TectonicStrength) /
        1000;
  const frameBands = [frame.distance, frame.source, frame.side, frame.reach, frame.overlap];
  if (step <= 0) {
    climbThrustRamps(map, context, components.length, climb);
    releaseWorking(map, ids, ...frameBands);
    return;
  }
  if (forming) pileUpEarlierShortening(map, context);
  const roots = distributeOrogenicRoots(map, context, components, frame);
  climbThrustRamps(map, context, components.length, climb);
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds.get(i);
    if (id >= 0) constructTriangle(map, context, components[id], frame, i, step, roots);
  }
  if (!forming) sutureReactivation(map, context);
  releaseWorking(map, ids, ...frameBands, roots);
}
/** Relax against the contacts that remain after the move, even if no mountains were built. */
export function relaxOrogenicCrust(map: PhysicalField, context: PhysicalContext) {
  map.OrogenicComponentIds.fill(-1);
  map.OrogenicSystemProminence.fill(0);
  const ids = workingArray(map, "int32", "relaxation:components").fill(-1),
    components = discoverComponents(map, context, ids);
  rankComponents(components, context);
  const frame = propagateInfluence(map, context, components, ids);
  crustFlow(map, context, (i) => {
    const id = map.OrogenicComponentIds.get(i);
    return (
      context.TectonicStrength > 0 &&
      id >= 0 &&
      components[id].code === 1 &&
      inBelt(map, components[id], i)
    );
  });
  releaseWorking(map, ids, frame.distance, frame.source, frame.side, frame.reach, frame.overlap);
}
