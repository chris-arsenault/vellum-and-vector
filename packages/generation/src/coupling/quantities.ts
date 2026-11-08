import type { PhysicalBufferName } from "../world/field";
import { ecologyCarbon, ecologyMemory, ecologyRatios, ecologyScalars } from "../world/ecologyState";
import { units } from "../world/math";
import type { MapScale } from "@atlas/domain";
import { rockLayerDepths, rockLayerKinds } from "../rock/rockLayerFields";
import {
  groundMaterialFields,
  groundPlacementFields,
  groundProjectionFields,
  groundSheetFields,
} from "../rock/groundTransport";
import {
  loadIntegerFields,
  loadScalarFields,
  seaLoadIntegerFields,
  seaLoadScalarFields,
} from "../rock/groundLoad";

/**
 * What a quantity is decides what history does to it, so a new band moves with the crust because of
 * what it declares, not because someone remembered to add it to a list.
 *
 * - `share`: a property of the ground that arrives as an area-weighted mean.
 * - `amount`: something there is more of when more arrives, so it sums.
 * - `peak`: a record of the most that happened; the largest arrival stands.
 * - `identity`: a label that cannot be averaged. Its own rule picks one arrival.
 * - `crust`: conserved crust columns, moved by crust transport with their own budget.
 * - `derived`: worked out afresh from other quantities; plates do not carry it.
 */
export type QuantityKind =
  "share" | "amount" | "peak" | "identity" | "crust" | "ground" | "derived";

const each = (kind: QuantityKind, names: readonly string[]) =>
  Object.fromEntries(names.map((name) => [name, kind]));

/** Every band in the field, by kind. A conformance test fails on any band missing from here. */
export const quantityKinds = {
  ...each("derived", ecologyScalars),
  ...each("share", [
    ...rockLayerDepths,
    ...ecologyRatios,
    "CanopyAge",
    "Evapotranspiration",
    "Productivity",
    "AquaticProductivity",
    "OrganicBurialDepth",
    "OrganicMaturity",
    "BedrockElevation",
    "CrustSupportElevation",
    "CrustAge",
    "CrustRiftStrain",
    "CrustRiftAgeMyr",
    "RockResistance",
    "CrustSutureStrength",
    "ImpactHeat",
    "Quickening",
    "Stillness",
    "IcePersistence",
    "IceCharge",
    "ExternalUpwelling",
    "ExternalSeaSurfaceForcing",
    "FogForcing",
    "StormForcing",
    "StormTrack",
    "FirstEpochHeight",
    "Verdure",
    "Salting",
    "LakeMemory",
    "Warding",
    "KeptLine",
    "Tearing",
    "RiverWarmth",
    "EcologyStillness",
    "StructuralGrainX",
    "StructuralGrainY",
  ]),
  ...each("amount", [
    ...ecologyCarbon,
    ...ecologyMemory,
    "Grazers",
    "Browsers",
    "Herbivores",
    "Predators",
    "AquaticFauna",
    "Tenure",
    "WalkedRoute",
    "MassDeath",
    "SoilDepth",
    "SoilWater",
    "MineralNutrients",
    "MigrationFlux",
    "SurfaceRockLoad",
    "VolcanicMeltSupply",
    "OceanicSubduction",
    "OceanicSubductionHistory",
    "SedimentThickness",
    "SedimentSupply",
    "CumulativeFluvialErosion",
    "CumulativeGlacialErosion",
    "CumulativeGlacialDeposition",
    "CumulativeCoastalErosion",
    "CumulativeDeposition",
    "ImpactExcavation",
    "ImpactRimUplift",
    "ImpactEjectaThickness",
    "VolcanicConstructionHistory",
    "TectonicActivityHistory",
  ]),
  ...each("peak", [
    "FractureConductance",
    "GeothermalHistory",
    "WaveExposureHistory",
    "MaximumIceThickness",
    "MaximumIceFlux",
    "MaximumGroundedIceFlux",
    "ExternalCoastalForcingHistory",
  ]),
  ...each("identity", [
    "CrustAssemblyIds",
    "CrustPlateIds",
    "CrustSuturePairIds",
    "VolcanicLastActiveEpoch",
    "FeatureFlags",
    "BiomeCodes",
    "RockKindCodes",
    ...rockLayerKinds,
  ]),
  ...each("crust", [
    "CrustThickness",
    "CrustContinentalColumn",
    "CrustContinentalFraction",
    "CrustRootReserve",
  ]),
} as Record<string, QuantityKind>;

for (const name of [
  "CrustBasePotential",
  "CrustAssemblySeparation",
  "CrustCollisionIntensity",
  "CrustProvinceSeam",
  "CrustMotionX",
  "CrustMotionY",
  "CrustProvinceIds",
  "CrustTypeCodes",
  "AdvectionSourceIndex",
  "MarginCodes",
  "CoastalMarginCodes",
  "ContinentalPotential",
  "Temperature",
  "WindX",
  "WindY",
  "UpwindTargets",
  "MoistureBarriers",
  "PrecipitationBarriers",
  "UpwindOceanSources",
  "TectonicBoundaryCodes",
  "TectonicStrain",
  "InitialTectonicBoundaryCodes",
  "InitialTectonicStrain",
  "TectonicBoundaryPairIds",
  "TectonicTangentX",
  "TectonicTangentY",
  "OrogenicComponentIds",
  "ThrustPairIds",
  "ThrustSheetIndex",
  "ThrustSegmentIds",
  "ThrustAcross",
  "ThrustDip",
  "OceanCurrentX",
  "OceanCurrentY",
  "OceanCurrentStrength",
  "OceanCurrentHeat",
  "SeaSurfaceAnomaly",
  "Upwelling",
  "WaveExposure",
  "Rainfall",
  "Snowfall",
  "SeaIceSuitability",
  "GlacialMeltwater",
  "ExternalHeatForcing",
  "ExternalCoastalForcing",
  "Moisture",
  "Geothermal",
  "MantlePlumeRootStrength",
  "VolcanicActivity",
  "LandformCodes",
  "WaterKindCodes",
  "WaterBodyIds",
  "DrainageBasinIds",
  "FlowEdges",
  "RiverOrders",
  "RiverChannelStrength",
  "RiverChannelOrders",
  "FloodplainIntensity",
  "DeltaIntensity",
  "RiverSpineEdgeMasks",
  "LandmassIds",
  "LandmassClassCodes",
  "ContinentalGroupIds",
  "BathymetricZoneCodes",
  "IceFlowTargets",
  "IceBalance",
  "GroundedIce",
  "HeatSourceDensity",
  "DrainageParents",
  "DrainageRanks",
  "DrainageGuidanceTargets",
  "FlowTargets",
  "LakeOutletTargets",
  "Runoff",
  "Warmth",
  "Elevation",
  "CrustSupportTarget",
  "OrogenicConstruction",
  "ConvergentCrustSurplus",
  "LandmarkMaintenance",
  "Slope",
  "WaterDepths",
  "WaterSurfaceElevations",
  "DrainageElevations",
  "LakeOverflow",
  "RidgeInfluence",
  "Uplift",
  "OceanMarginDistance",
  "OceanDistance",
  "Seasonality",
  "WindSpeed",
  "ColumnPrecipitation",
  "FlowAccumulation",
  "CatchmentArea",
  "RiverWidth",
  "RiverDepth",
  "IceFlux",
  "IceThickness",
  "IceRetreat",
])
  quantityKinds[name] = "derived";

// These travel as complete ground packages. Independently averaging a layer's thickness,
// strength or fabric while selecting its kind from another donor invents material history.
for (const name of [
  ...groundMaterialFields,
  ...groundPlacementFields,
  ...groundProjectionFields,
  ...groundSheetFields,
  ...loadIntegerFields,
  ...loadScalarFields,
  ...seaLoadIntegerFields,
  ...seaLoadScalarFields,
  "SedimentSupply",
])
  quantityKinds[name] = "ground";

export const quantitiesOfKind = (kind: QuantityKind) =>
  Object.keys(quantityKinds).filter((name) => quantityKinds[name] === kind) as PhysicalBufferName[];

/** Policies actually used when a plate transports quantities. Derived bands are recomputed by
 * their scheduled processes; crust columns have their own transport operation. */
export type TransportAnswer =
  "mean" | "sum" | "largest" | "dominant" | "conserved" | "package" | "recompute";
export const transportRules: Readonly<
  Record<
    QuantityKind,
    {
      moved: TransportAnswer;
      newCrust: "fresh" | "zero";
      rifted: "blend" | "carry";
    }
  >
> = {
  share: { moved: "mean", newCrust: "fresh", rifted: "blend" },
  amount: { moved: "sum", newCrust: "zero", rifted: "carry" },
  peak: { moved: "largest", newCrust: "zero", rifted: "carry" },
  identity: { moved: "dominant", newCrust: "zero", rifted: "carry" },
  crust: { moved: "conserved", newCrust: "zero", rifted: "carry" },
  ground: { moved: "package", newCrust: "fresh", rifted: "carry" },
  derived: { moved: "recompute", newCrust: "zero", rifted: "carry" },
};

/** What a `share` quantity reads on brand new crust, where nothing arrived. */
export const freshCrustValue = (name: PhysicalBufferName, scale: MapScale) => {
  if (name === "BedrockElevation" || name === "CrustSupportElevation")
    return units(scale.length(-0.00005));
  return name === "RockResistance" ? 1000 : 0;
};
/**
 * An identity that is not simply the crust that mostly arrived states its own rule: whose arrival
 * counts most, by `weighBy` times the share arriving, or the latest or every one past `least` of a
 * cell; where it holds only while `heldWhile` stands; and what it clears when that has gone.
 */
export interface IdentityRule {
  readonly pick: "heaviest" | "latest" | "every";
  readonly weighBy?: PhysicalBufferName;
  /** The least share of a whole cell an arrival must bring to count. */
  readonly least?: number;
  readonly heldWhile?: PhysicalBufferName;
  /** For a set of flags: which go when `heldWhile` has gone. */
  readonly clears?: number;
}
export const identityRules: Readonly<Partial<Record<PhysicalBufferName, IdentityRule>>> = {
  // An assembly is the continent's: it goes with the most continental crust that arrived.
  CrustAssemblyIds: {
    pick: "heaviest",
    weighBy: "CrustContinentalFraction",
    heldWhile: "CrustContinentalFraction",
  },
  CrustPlateIds: { pick: "heaviest" },
  CrustSuturePairIds: {
    pick: "heaviest",
    weighBy: "CrustSutureStrength",
    heldWhile: "CrustSutureStrength",
  },
  VolcanicLastActiveEpoch: {
    pick: "latest",
    least: 0.05,
    heldWhile: "VolcanicConstructionHistory",
  },
  // Cones, calderas and lava plains go when the volcanic rock they stood on has.
  FeatureFlags: {
    pick: "every",
    least: 0.05,
    heldWhile: "VolcanicConstructionHistory",
    clears: (1 << 8) | (1 << 9) | (1 << 10),
  },
};
/** Amounts that are material on its way somewhere: what sinks with the crust goes to their pool. */
export const returnPools: Readonly<Partial<Record<PhysicalBufferName, "sea">>> = {};
