// CrustalSupportLayer.cs and LithosphericFlexureLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, crustHeight, ratio, rockLoadResponsePerMille, toUnits, units } from "./math";
import { setSupportTarget, supportGroundField } from "../rock/groundDeformation";
import { smoothMetric } from "./metricSmoothing";
import { releaseWorking, workingValues } from "./physicalNumerics";
import {
  tectonicRiftCoolingMyr,
  tectonicRiftFailure,
  tectonicRiftSubsidence,
} from "./tectonicControls";

export function crustalSupport(map: PhysicalField, context: PhysicalContext) {
  const p = context.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    const fraction = map.CrustContinentalFraction.get(i) / 1000;
    const airy = units(crustHeight(toUnits(map.CrustThickness.get(i)), fraction, map.scale));
    const oceanic = clamp(1 - fraction / p.OceanicSubsidenceCompositionLimit, 0, 1);
    const subsidence = units(((oceanic * map.CrustAge.get(i)) / 1000) * p.OceanicSubsidenceDepth);
    const riftCooling = units(
      ((tectonicRiftSubsidence(map.scale) *
        p.ContinentalAssemblySeparationDepth *
        p.MarginEvolutionResponsePerMille) /
        1000) *
        clamp(map.CrustRiftStrain.get(i) / tectonicRiftFailure, 0, 1) *
        (1 - Math.exp(-map.CrustRiftAgeMyr.get(i) / tectonicRiftCoolingMyr))
    );
    let load =
      ratio(map.SurfaceRockLoad.get(i), rockLoadResponsePerMille, 1000) +
      ratio(map.SedimentThickness.get(i), p.SedimentLoadResponsePerMille, 1000);
    if (map.GroundedIce.get(i) !== 0)
      load += ratio(units(map.IceThickness.get(i)), p.IceLoadResponsePerMille, 1000);
    setSupportTarget(
      map,
      i,
      airy - subsidence - riftCooling - trenchSupport(map, context, i) - load
    );
  }
}
function trenchSupport(map: PhysicalField, context: PhysicalContext, i: number) {
  // Stored consumption describes the parcel's past; a trench needs a current convergent load.
  if (context.TectonicStrength <= 0 || map.TectonicBoundaryCodes.get(i) !== 1) return 0;
  const consumed = map.OceanicSubductionHistory.get(i) / units(map.scale.length(0.00025));
  const oceanic = 1 - map.CrustContinentalFraction.get(i) / 1000;
  return units(context.Profile.ConvergentTrenchDepth * oceanic * (1 - Math.exp(-consumed)));
}
/**
 * A plate bends under a load, but a continent's edge is not bent down by the deep sea floor beside it:
 * a margin is where the two are broken apart. So continent and ocean each settle among themselves.
 */
function settledSupport(map: PhysicalField, context: PhysicalContext) {
  const p = context.Profile,
    edge = p.OceanicSubsidenceCompositionLimit * 1000,
    continent = workingValues(map, "uint8", "flexure:continent", (i) =>
      map.CrustContinentalFraction.get(i) >= edge ? 1 : 0
    ),
    ocean = workingValues(map, "uint8", "flexure:ocean", (i) => (continent.get(i) ? 0 : 1)),
    onContinent = smoothMetric(map, map.CrustSupportTarget, p.LithosphericFlexureLength, continent),
    current = smoothMetric(map, onContinent, p.LithosphericFlexureLength, ocean);
  releaseWorking(map, continent, ocean, onContinent);
  return current;
}
export function lithosphericFlexure(map: PhysicalField, context: PhysicalContext) {
  const current = settledSupport(map, context);
  supportGroundField(map, current);
  releaseWorking(map, current);
}
