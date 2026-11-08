// OrogenicConstructionLayer finite deformation and constructed summit rock, Canonry 0f62584c.
import { crustForming, type PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import {
  discoverComponents,
  propagateInfluence,
  type BoundaryComponent,
  type OrogenicFrame,
} from "./orogenicComponents";
import {
  crossSection,
  displaceFaultBlocks,
  orogenicCrestSection,
  summitVariation,
} from "./orogenicShape";
import { buoyancy, clamp, crustPerRock, toUnits, units } from "./math";
import { deformGround, raiseGroundField } from "../rock/groundDeformation";
import { crustFlow, distributeOrogenicRoots, pileUpEarlierShortening } from "./orogenicRoots";
import { advanceThrustFronts, climbThrustRamps, inBelt, slipThrustSheets } from "./orogenicSheets";
import { sutureReactivation } from "./reactivation";
import type { Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";

function recordActivity(map: PhysicalField, context: PhysicalContext, i: number, admitted: number) {
  const value = toUnits(admitted);
  map.TectonicActivityHistory.set(
    i,
    Math.min(2147483647, map.TectonicActivityHistory.get(i) + Math.abs(value))
  );
  if (value <= 0) return;
  const uplift = value / Math.max(1, map.mesh.spacing * context.Profile.ThrustRampGradient);
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
  if (value <= 0 || map.CrustContinentalFraction.get(i) / 1000 < 0.35 || c.code !== 1) return 0;
  const crest = clamp(section / orogenicCrestSection, 0, 1),
    fraction = map.CrustContinentalFraction.get(i) / 1000,
    // Of the crust that reached this column, this share stands up as rock and the rest stays as root.
    rockFromCrust =
      (value / (buoyancy(fraction) / 1000) / crustPerRock(fraction)) * p.OrogenicRockShare,
    structural = rockFromCrust * (0.2 + crest * 0.8);
  return units(structural * summitVariation(map, context, c, i, source));
}
function constructTriangle(
  map: PhysicalField,
  context: PhysicalContext,
  c: BoundaryComponent,
  frame: OrogenicFrame,
  i: number,
  roots: Band,
  surface: Band
) {
  const source = frame.source.get(i),
    section = crossSection(map, context, c, frame, i);
  const admitted = roots.get(i);
  map.OrogenicConstruction.set(i, admitted);
  recordActivity(map, context, i, admitted);
  recordGrain(map, c, i, source, admitted);
  surface.set(i, constructSurface(map, context, c, i, source, section, admitted));
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
  admitted: number
) {
  if (toUnits(admitted) <= 0 || c.code !== 1) return;
  const tx = map.TectonicTangentX.get(source) / 1000,
    ty = map.TectonicTangentY.get(source) / 1000,
    length = Math.hypot(tx, ty);
  if (length < 0.01) return;
  deformGround(map, i, tx, ty, 1, admitted);
}
export function orogenicConstruction(map: PhysicalField, context: PhysicalContext) {
  map.OrogenicComponentIds.fill(-1);
  map.OrogenicConstruction.fill(0);
  if (context.TectonicStrength <= 0 || context.Span <= 0) return;
  const ids = workingArray(map, "int32", "orogeny:components").fill(-1);
  const components = discoverComponents(map, context, ids);
  const frame = propagateInfluence(map, context, components, ids);
  advanceThrustFronts(map, context, components, frame);
  const climb = slipThrustSheets(map, context, components, frame);
  const forming = crustForming(map);
  const frameBands = [frame.distance, frame.source, frame.reach, frame.overlap];
  if (forming) pileUpEarlierShortening(map, context);
  const roots = distributeOrogenicRoots(map, context, components, frame),
    surface = workingArray(map, "float64", "orogeny:surface").fill(0);
  climbThrustRamps(map, context, components.length, climb);
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds.get(i);
    if (id >= 0 && components[id].code === 1)
      constructTriangle(map, context, components[id], frame, i, roots, surface);
  }
  raiseGroundField(map, surface, "mountains");
  displaceFaultBlocks(map, context);
  if (!forming) sutureReactivation(map, context);
  releaseWorking(map, ids, ...frameBands, roots, surface);
}
/** Relax against the contacts that remain after the move, even if no mountains were built. */
export function relaxOrogenicCrust(map: PhysicalField, context: PhysicalContext) {
  map.OrogenicComponentIds.fill(-1);
  const ids = workingArray(map, "int32", "relaxation:components").fill(-1),
    components = discoverComponents(map, context, ids);
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
  releaseWorking(map, ids, frame.distance, frame.source, frame.reach, frame.overlap);
}
