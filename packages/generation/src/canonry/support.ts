// CrustalSupportLayer.cs and LithosphericFlexureLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, crustHeight, elevationLimit, ratio, toUnits, units } from "./math";
import { rebuild } from "./surface";
import { smoothMetric } from "./metricSmoothing";
import { releaseWorking } from "./physicalNumerics";
import {
  tectonicRiftCoolingMyr,
  tectonicRiftFailure,
  tectonicRiftSubsidence,
} from "./tectonicControls";

export function crustalSupport(map: PhysicalField, context: PhysicalContext, includeIce: boolean) {
  const p = context.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    const fraction = map.CrustContinentalFraction.get(i) / 1000;
    const airy = units(crustHeight(toUnits(map.CrustThickness.get(i)), fraction));
    const oceanic = clamp(1 - fraction / p.OceanicSubsidenceCompositionLimit, 0, 1);
    const subsidence = units(((oceanic * map.CrustAge.get(i)) / 1000) * p.OceanicSubsidenceDepth);
    const riftCooling = units(
      ((tectonicRiftSubsidence *
        p.ContinentalAssemblySeparationDepth *
        p.MarginEvolutionResponsePerMille) /
        1000) *
        clamp(map.CrustRiftStrain.get(i) / tectonicRiftFailure, 0, 1) *
        (1 - Math.exp(-map.CrustRiftAgeMyr.get(i) / tectonicRiftCoolingMyr))
    );
    let load =
      ratio(map.SurfaceRockLoad.get(i), p.BedrockLoadResponsePerMille, 1000) +
      ratio(map.SedimentThickness.get(i), p.SedimentLoadResponsePerMille, 1000);
    if (includeIce && map.GroundedIce.get(i) !== 0)
      load += ratio(units(map.IceThickness.get(i)), p.IceLoadResponsePerMille, 1000);
    map.CrustSupportTarget.set(
      i,
      clamp(
        airy - subsidence - riftCooling - trenchSupport(map, context, i) - load,
        units(-elevationLimit),
        units(elevationLimit)
      )
    );
  }
}
function trenchSupport(map: PhysicalField, context: PhysicalContext, i: number) {
  const consumed = map.OceanicSubductionHistory.get(i) / units(1000);
  const oceanic = 1 - map.CrustContinentalFraction.get(i) / 1000;
  return units(context.Profile.ConvergentTrenchDepth * oceanic * (1 - Math.exp(-consumed)));
}
export function lithosphericFlexure(map: PhysicalField, context: PhysicalContext) {
  const current = smoothMetric(
    map,
    map.CrustSupportTarget,
    context.Profile.LithosphericFlexureLength
  );
  for (let i = 0; i < current.length; i++) {
    const value = current.get(i);
    if (!map.CrustSupportInitialized) {
      map.CrustSupportElevation.set(i, value);
      continue;
    }
    const old = map.CrustSupportElevation.get(i),
      shift = value - old,
      before = map.BedrockElevation.get(i);
    const bedrock = clamp(
      before + shift,
      units(-elevationLimit),
      units(elevationLimit) - map.SedimentThickness.get(i)
    );
    map.CrustSupportElevation.set(i, old + bedrock - before);
    map.BedrockElevation.set(i, bedrock);
    rebuild(map, i);
  }
  map.CrustSupportInitialized = true;
  releaseWorking(map, current);
}
