import type { PhysicalBufferName } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalField } from "./field";
import type { NativeStep } from "./sequence";
import { validateNativeLayer } from "./layerValidation";

/**
 * What each world step works from and leaves behind, in the bands themselves. A step that needs a band
 * cannot run unless a selected step wrote it earlier, or the map inherited it. That is all this says:
 * a band's being written says nothing about whether it is still right, and a band a step can do
 * without is not listed here, because an unwritten band reads as nothing happened. The architecture
 * check holds these lists to what the code actually reads and writes.
 */
export interface PhysicalStep {
  readonly needs: readonly PhysicalBufferName[];
  readonly writes: readonly PhysicalBufferName[];
  /** What a step leaves that is not a band. */
  readonly leaves?: readonly string[];
}
const provinces = "CrustProvinceIds",
  sea = "WaterKindCodes",
  ground = "Elevation",
  rock = "RockKindCodes";
export const physicalSteps: Readonly<Record<string, PhysicalStep>> = {
  "tectonic-provinces": {
    needs: [],
    writes: [
      provinces,
      "CrustPlateIds",
      "CrustContinentalFraction",
      "CrustMotionX",
      "CrustMotionY",
      "TectonicBoundaryCodes",
      "InitialTectonicBoundaryCodes",
      "TectonicStrain",
    ],
  },
  "tectonic-epoch-activity": {
    needs: ["InitialTectonicBoundaryCodes"],
    writes: ["TectonicBoundaryCodes", "TectonicStrain"],
  },
  "continental-sutures": {
    needs: ["TectonicBoundaryCodes", "CrustContinentalFraction"],
    writes: ["CrustSutureStrength", "CrustCollisionIntensity"],
  },
  "tectonic-margins": {
    needs: ["TectonicBoundaryCodes", "CrustContinentalFraction"],
    writes: ["MarginCodes", "CrustAge"],
  },
  "continental-domains": { needs: ["TectonicBoundaryCodes"], writes: ["ContinentalPotential"] },
  "tectonic-uplift": {
    needs: [provinces, "ContinentalPotential"],
    writes: [ground, "BedrockElevation", "CrustThickness"],
  },
  "landscape-initialization": {
    needs: [provinces],
    writes: [rock, "RockResistance", "CrustSupportElevation", "BedrockElevation"],
  },
  "plate-advection": {
    needs: [provinces, rock],
    writes: [ground, "BedrockElevation", "CrustThickness", "CrustPlateIds", provinces],
  },
  "orogenic-construction": {
    needs: [ground, provinces, rock],
    writes: [ground, "BedrockElevation", "CrustThickness", "OrogenicConstruction"],
  },
  "mantle-plume-roots": { needs: [provinces], writes: ["MantlePlumeRootStrength"] },
  "volcanic-construction": {
    needs: [ground, rock],
    writes: [
      ground,
      "BedrockElevation",
      "VolcanicConstructionHistory",
      "VolcanicActivity",
      "FractureConductance",
    ],
  },
  "impact-cratering": {
    needs: [ground, rock],
    writes: [
      ground,
      "BedrockElevation",
      "SedimentSupply",
      "ImpactExcavation",
      "FractureConductance",
    ],
  },
  "mass-wasting": {
    needs: [ground, rock],
    writes: [ground, "BedrockElevation", "SedimentThickness"],
  },
  "post-fluvial-mass-wasting": {
    needs: [ground, rock],
    writes: [ground, "BedrockElevation", "SedimentThickness"],
  },
  "crustal-support": { needs: ["CrustThickness"], writes: ["CrustSupportTarget"] },
  "lithospheric-flexure": {
    needs: ["CrustSupportTarget"],
    writes: [ground, "BedrockElevation", "CrustSupportElevation"],
  },
  "ocean-connectivity": {
    needs: [ground],
    writes: [sea, "WaterDepths", "WaterSurfaceElevations", "WaterBodyIds"],
  },
  "continental-margin-evolution": {
    needs: [ground, sea, "MarginCodes"],
    writes: [ground, "BedrockElevation", "CoastalMarginCodes", "OceanMarginDistance"],
  },
  "marine-sedimentation": {
    needs: [ground, sea, "OceanMarginDistance"],
    writes: [ground, "SedimentThickness", "CumulativeDeposition"],
  },
  "coastal-detail": {
    needs: [ground, "MarginCodes"],
    writes: [ground, "BedrockElevation"],
  },
  "fracture-network": { needs: ["TectonicStrain"], writes: ["FractureConductance"] },
  geothermal: {
    needs: ["TectonicBoundaryCodes", "FractureConductance"],
    writes: ["Geothermal", "HeatSourceDensity"],
  },
  "ocean-distance": { needs: [sea], writes: ["OceanDistance"] },
  bathymetry: { needs: [ground, sea], writes: ["BathymetricZoneCodes", "Slope"] },
  "landmasses-and-shelf-groups": {
    needs: [ground, sea],
    writes: ["LandmassIds", "LandmassClassCodes", "ContinentalGroupIds"],
  },
  "ocean-currents": {
    needs: [sea, "WaterDepths"],
    writes: ["OceanCurrentX", "OceanCurrentY", "OceanCurrentStrength", "WaveExposure"],
  },
  "warmth-sources": { needs: [ground, sea], writes: ["Warmth"] },
  temperature: { needs: [ground, sea], writes: ["Temperature", "Seasonality"] },
  "atmospheric-flow": {
    needs: [ground, sea],
    writes: ["WindX", "WindY", "UpwindTargets", "MoistureBarriers", "PrecipitationBarriers"],
  },
  "moisture-transport": {
    needs: [ground, sea, "Temperature", "UpwindTargets"],
    writes: ["Moisture", "ColumnPrecipitation"],
  },
  precipitation: {
    needs: ["Temperature", "ColumnPrecipitation"],
    writes: ["Rainfall", "Snowfall"],
  },
  runoff: { needs: [sea, "Temperature", "Rainfall"], writes: ["Runoff"] },
  "drainage-conditioning": {
    needs: [ground, sea],
    writes: ["DrainageElevations", "DrainageParents", "DrainageRanks"],
  },
  "lake-basins": {
    needs: [ground, sea, "Runoff", "DrainageElevations"],
    writes: ["LakeOutletTargets", "LakeOverflow", sea, "WaterDepths", "WaterSurfaceElevations"],
  },
  "drainage-guidance": {
    needs: [ground, sea, "DrainageElevations"],
    writes: ["DrainageGuidanceTargets"],
  },
  "flow-routing": {
    needs: [sea, "DrainageParents", "DrainageGuidanceTargets"],
    writes: ["FlowTargets", "FlowEdges", "DrainageBasinIds"],
  },
  "river-network": {
    needs: ["Runoff", "FlowTargets"],
    writes: ["RiverOrders", "CatchmentArea", "FlowAccumulation"],
  },
  "ancestral-fluvial-erosion": {
    needs: [ground, sea, rock],
    writes: [ground, "BedrockElevation", "SedimentSupply"],
  },
  "sediment-transport": {
    needs: [ground, "FlowTargets", "CatchmentArea"],
    writes: [ground, "SedimentThickness", "CumulativeDeposition"],
  },
  "land-ice-mass-balance": {
    needs: [ground, sea, "Temperature", "Moisture", "Snowfall"],
    writes: ["IceThickness", "IceBalance", "MaximumIceThickness"],
  },
  "ice-flow": {
    needs: [ground, sea, "IceThickness"],
    writes: ["IceFlux", "IceFlowTargets", "GroundedIce"],
  },
  "glacial-erosion": {
    needs: [ground, rock, "IceFlux", "IceFlowTargets", "IceThickness"],
    writes: [ground, "BedrockElevation", "SedimentSupply"],
  },
  "glacial-deposition": {
    needs: [ground, "IceFlowTargets", "IceFlux"],
    writes: [ground, "SedimentThickness", "CumulativeGlacialDeposition"],
  },
  "glacial-meltwater": {
    needs: [sea, "Temperature", "IceThickness"],
    writes: ["GlacialMeltwater"],
  },
  "glacial-runoff": { needs: [sea, "Runoff"], writes: ["Runoff"] },
  "external-coastal-forcing": {
    needs: [ground, sea],
    writes: [ground, "BedrockElevation", "CumulativeCoastalErosion"],
  },
  "coastal-erosion-and-deposition": {
    needs: [ground, sea, rock],
    writes: [ground, "BedrockElevation", "CumulativeCoastalErosion"],
  },
  "glacial-landforms": { needs: [ground, sea], writes: ["LandformCodes"] },
  "sea-ice": { needs: [sea, "Temperature"], writes: ["SeaIceSuitability"] },
  "landform-classification": {
    needs: [ground, sea, "RiverOrders"],
    writes: ["LandformCodes", "Slope"],
  },
  "river-channel-geometry": {
    needs: [ground, "FlowTargets", "RiverOrders"],
    writes: ["RiverWidth", "RiverDepth", "RiverChannelStrength", "RiverChannelOrders"],
  },
  "river-floodplains": {
    needs: [ground, "FlowTargets", "RiverOrders", "RiverChannelOrders"],
    writes: ["FloodplainIntensity"],
  },
  "river-delta-formation": {
    needs: [sea, "FlowTargets", "RiverOrders", "RiverChannelOrders"],
    writes: ["DeltaIntensity"],
  },
  lithification: { needs: [ground, rock], writes: [rock, "BedrockElevation"] },
  "rock-metamorphism": { needs: ["RockResistance"], writes: [rock, "RockResistance"] },
  "physical-epoch-history": { needs: [ground], writes: ["FirstEpochHeight"] },
  "physical-structural-validation": {
    needs: [sea, "FlowTargets"],
    writes: [],
    leaves: ["atlas:validated"],
  },
};
/** The ledger's name for a band having been written. */
export const fieldProduct = (band: PhysicalBufferName) => `field:${band}`;
/** Something watching the world's steps as they finish, to record what each one did. */
export type NativeStepObserver = (
  name: string,
  map: PhysicalField,
  context: PhysicalContext
) => void;
let stepObserver: NativeStepObserver | null = null;
export function observeNativeSteps(observer: NativeStepObserver | null) {
  stepObserver = observer;
}
/** Runs a step, then checks what it left within the physical ranges its bands must hold. */
export function applyNativeStep(map: PhysicalField, context: PhysicalContext, step: NativeStep) {
  const [name, , process] = step;
  try {
    process(map, context);
    validateNativeLayer(map, context, name, physicalSteps[name]?.writes ?? []);
    stepObserver?.(name, map, context);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${name} failed in epoch ${context.EpochIndex + 1}: ${detail}`, { cause });
  }
}
