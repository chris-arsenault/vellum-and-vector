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
    const fraction = map.CrustContinentalFraction[i] / 1000;
    const airy = units(crustHeight(toUnits(map.CrustThickness[i]), fraction));
    const oceanic = clamp(1 - fraction / p.OceanicSubsidenceCompositionLimit, 0, 1);
    const subsidence = units(((oceanic * map.CrustAge[i]) / 1000) * p.OceanicSubsidenceDepth);
    const riftCooling = units(
      ((tectonicRiftSubsidence *
        p.ContinentalAssemblySeparationDepth *
        p.MarginEvolutionResponsePerMille) /
        1000) *
        clamp(map.CrustRiftStrain[i] / tectonicRiftFailure, 0, 1) *
        (1 - Math.exp(-map.CrustRiftAgeMyr[i] / tectonicRiftCoolingMyr))
    );
    let load =
      ratio(map.SurfaceRockLoad[i], p.BedrockLoadResponsePerMille, 1000) +
      ratio(map.SedimentThickness[i], p.SedimentLoadResponsePerMille, 1000);
    if (includeIce && map.GroundedIce[i] !== 0)
      load += ratio(units(map.IceThickness[i]), p.IceLoadResponsePerMille, 1000);
    map.CrustSupportTarget[i] = clamp(
      airy - subsidence - riftCooling - trenchSupport(map, context, i) - load,
      units(-elevationLimit),
      units(elevationLimit)
    );
  }
}
function trenchSupport(map: PhysicalField, context: PhysicalContext, i: number) {
  const consumed = map.OceanicSubductionHistory[i] / units(1000);
  const oceanic = 1 - map.CrustContinentalFraction[i] / 1000;
  return units(context.Profile.ConvergentTrenchDepth * oceanic * (1 - Math.exp(-consumed)));
}
export function lithosphericFlexure(map: PhysicalField, context: PhysicalContext) {
  const current = smoothMetric(
    map.mesh,
    map.CrustSupportTarget,
    context.Profile.LithosphericFlexureLength,
    undefined,
    map.numerical
  );
  for (let i = 0; i < current.length; i++) {
    if (!map.CrustSupportInitialized) {
      map.CrustSupportElevation[i] = current[i];
      continue;
    }
    const old = map.CrustSupportElevation[i],
      shift = current[i] - old;
    const bedrock = clamp(
      map.BedrockElevation[i] + shift,
      units(-elevationLimit),
      units(elevationLimit) - map.SedimentThickness[i]
    );
    map.CrustSupportElevation[i] = old + bedrock - map.BedrockElevation[i];
    map.BedrockElevation[i] = bedrock;
    rebuild(map, i);
  }
  map.CrustSupportInitialized = true;
  releaseWorking(map, current);
}
