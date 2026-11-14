import type { SampleType } from "./workspaceResources";
declare const integerFields: readonly [
  "GroundwaterTargets",
  "BiomeCodes",
  "CrustBasePotential",
  "CrustAssemblyIds",
  "CrustPlateIds",
  "CrustAssemblySeparation",
  "CrustCollisionIntensity",
  "CrustSuturePairIds",
  "CrustSutureStrength",
  "CrustProvinceSeam",
  "RockResistance",
  "CrustMotionX",
  "CrustMotionY",
  "CrustProvinceIds",
  "CrustTypeCodes",
  "CrustContinentalFraction",
  "AdvectionSourceIndex",
  "MarginCodes",
  "CoastalMarginCodes",
  "CrustAge",
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
  "StructuralGrainX",
  "StructuralGrainY",
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
  "SeaIceSuitability",
  "TectonicActivityHistory",
  "WaveExposureHistory",
  "GeothermalHistory",
  "ImpactHeat",
  "ExternalHeatForcing",
  "ExternalCoastalForcing",
  "ExternalCoastalForcingHistory",
  "Moisture",
  "Geothermal",
  "MantlePlumeRootStrength",
  "VolcanicActivity",
  "VolcanicLastActiveEpoch",
  "LandformCodes",
  "RockKindCodes",
  ...(
    | "RockLayerKind0"
    | "RockLayerKind1"
    | "RockLayerKind2"
    | "RockLayerKind3"
    | "RockLayerKind4"
    | "RockLayerKind6"
    | "RockLayerKind7"
    | "RockLayerKind5"
    | "RockCutLayerKind0"
    | "RockCutLayerKind1"
    | "RockCutLayerKind2"
    | "RockCutLayerKind3"
    | "RockCutLayerKind4"
    | "RockCutLayerKind6"
    | "RockCutLayerKind7"
    | "RockCutLayerKind5"
    | "LooseLayerKind0"
    | "LooseLayerKind1"
    | "LooseLayerKind2"
    | "LooseLayerKind3"
    | "LooseLayerKind4"
    | "LooseLayerKind6"
    | "LooseLayerKind7"
    | "LooseLayerKind5"
    | "LooseCutLayerKind0"
    | "LooseCutLayerKind1"
    | "LooseCutLayerKind2"
    | "LooseCutLayerKind3"
    | "LooseCutLayerKind4"
    | "LooseCutLayerKind6"
    | "LooseCutLayerKind7"
    | "LooseCutLayerKind5"
    | "RockLayerSecondaryKind0"
    | "RockLayerSecondaryKind1"
    | "RockLayerSecondaryKind2"
    | "RockLayerSecondaryKind3"
    | "RockLayerSecondaryKind4"
    | "RockLayerSecondaryKind6"
    | "RockLayerSecondaryKind7"
    | "RockLayerSecondaryKind5"
    | "RockCutLayerSecondaryKind0"
    | "RockCutLayerSecondaryKind1"
    | "RockCutLayerSecondaryKind2"
    | "RockCutLayerSecondaryKind3"
    | "RockCutLayerSecondaryKind4"
    | "RockCutLayerSecondaryKind6"
    | "RockCutLayerSecondaryKind7"
    | "RockCutLayerSecondaryKind5"
    | "LooseLayerSecondaryKind0"
    | "LooseLayerSecondaryKind1"
    | "LooseLayerSecondaryKind2"
    | "LooseLayerSecondaryKind3"
    | "LooseLayerSecondaryKind4"
    | "LooseLayerSecondaryKind6"
    | "LooseLayerSecondaryKind7"
    | "LooseLayerSecondaryKind5"
    | "LooseCutLayerSecondaryKind0"
    | "LooseCutLayerSecondaryKind1"
    | "LooseCutLayerSecondaryKind2"
    | "LooseCutLayerSecondaryKind3"
    | "LooseCutLayerSecondaryKind4"
    | "LooseCutLayerSecondaryKind6"
    | "LooseCutLayerSecondaryKind7"
    | "LooseCutLayerSecondaryKind5"
    | "RockLayerMixed0"
    | "RockLayerMixed1"
    | "RockLayerMixed2"
    | "RockLayerMixed3"
    | "RockLayerMixed4"
    | "RockLayerMixed6"
    | "RockLayerMixed7"
    | "RockLayerMixed5"
    | "RockCutLayerMixed0"
    | "RockCutLayerMixed1"
    | "RockCutLayerMixed2"
    | "RockCutLayerMixed3"
    | "RockCutLayerMixed4"
    | "RockCutLayerMixed6"
    | "RockCutLayerMixed7"
    | "RockCutLayerMixed5"
    | "LooseLayerMixed0"
    | "LooseLayerMixed1"
    | "LooseLayerMixed2"
    | "LooseLayerMixed3"
    | "LooseLayerMixed4"
    | "LooseLayerMixed6"
    | "LooseLayerMixed7"
    | "LooseLayerMixed5"
    | "LooseCutLayerMixed0"
    | "LooseCutLayerMixed1"
    | "LooseCutLayerMixed2"
    | "LooseCutLayerMixed3"
    | "LooseCutLayerMixed4"
    | "LooseCutLayerMixed6"
    | "LooseCutLayerMixed7"
    | "LooseCutLayerMixed5"
    | "GroundLoadKind"
    | "GroundLoadSecondaryKind"
    | "GroundLoadMixed"
    | "SeaLoadKind"
    | "SeaLoadSecondaryKind"
    | "SeaLoadMixed"
    | "WaterKindCodes"
    | "WaterBodyIds"
    | "DrainageBasinIds"
    | "FlowEdges"
    | "RiverOrders"
    | "RiverChannelStrength"
    | "RiverChannelOrders"
    | "FloodplainIntensity"
    | "DeltaIntensity"
    | "RiverSpineEdgeMasks"
    | "FeatureFlags"
    | "LandmassIds"
    | "LandmassClassCodes"
    | "ContinentalGroupIds"
    | "BathymetricZoneCodes"
    | "IceFlowTargets"
    | "IceBalance"
    | "GroundedIce"
    | "FractureConductance"
    | "HeatSourceDensity"
    | "DrainageParents"
    | "DrainageRanks"
    | "DrainageGuidanceTargets"
    | "FlowTargets"
    | "LakeOutletTargets"
    | "Warmth"
    | "RuinTongue"
    | "IdentityTongue0"
    | "IdentityTongue1"
    | "IdentityTongue2"
    | "IdentityTongue3"
    | "IdentityFaith0"
    | "IdentityFaith1"
    | "IdentityFaith2"
    | "IdentityFaith3"
    | "IdentityCustom0"
    | "IdentityCustom1"
    | "IdentityCustom2"
    | "IdentityCustom3"
    | "IdentityAllegiance0"
    | "IdentityAllegiance1"
    | "IdentityAllegiance2"
    | "IdentityAllegiance3"
    | "IdentityCraft0"
    | "IdentityCraft1"
    | "IdentityCraft2"
    | "IdentityCraft3"
  )[],
];
declare const elevationFields: readonly [
  ...(
    | "RockLayerDepth0"
    | "RockLayerDepth1"
    | "RockLayerDepth2"
    | "RockLayerDepth3"
    | "RockLayerDepth4"
    | "RockLayerDepth6"
    | "RockLayerDepth7"
    | "RockLayerDepth5"
    | "RockCutLayerDepth0"
    | "RockCutLayerDepth1"
    | "RockCutLayerDepth2"
    | "RockCutLayerDepth3"
    | "RockCutLayerDepth4"
    | "RockCutLayerDepth6"
    | "RockCutLayerDepth7"
    | "RockCutLayerDepth5"
    | "LooseLayerDepth0"
    | "LooseLayerDepth1"
    | "LooseLayerDepth2"
    | "LooseLayerDepth3"
    | "LooseLayerDepth4"
    | "LooseLayerDepth6"
    | "LooseLayerDepth7"
    | "LooseLayerDepth5"
    | "LooseCutLayerDepth0"
    | "LooseCutLayerDepth1"
    | "LooseCutLayerDepth2"
    | "LooseCutLayerDepth3"
    | "LooseCutLayerDepth4"
    | "LooseCutLayerDepth6"
    | "LooseCutLayerDepth7"
    | "LooseCutLayerDepth5"
    | "RockLayerSecondaryShare0"
    | "RockLayerSecondaryShare1"
    | "RockLayerSecondaryShare2"
    | "RockLayerSecondaryShare3"
    | "RockLayerSecondaryShare4"
    | "RockLayerSecondaryShare6"
    | "RockLayerSecondaryShare7"
    | "RockLayerSecondaryShare5"
    | "RockCutLayerSecondaryShare0"
    | "RockCutLayerSecondaryShare1"
    | "RockCutLayerSecondaryShare2"
    | "RockCutLayerSecondaryShare3"
    | "RockCutLayerSecondaryShare4"
    | "RockCutLayerSecondaryShare6"
    | "RockCutLayerSecondaryShare7"
    | "RockCutLayerSecondaryShare5"
    | "LooseLayerSecondaryShare0"
    | "LooseLayerSecondaryShare1"
    | "LooseLayerSecondaryShare2"
    | "LooseLayerSecondaryShare3"
    | "LooseLayerSecondaryShare4"
    | "LooseLayerSecondaryShare6"
    | "LooseLayerSecondaryShare7"
    | "LooseLayerSecondaryShare5"
    | "LooseCutLayerSecondaryShare0"
    | "LooseCutLayerSecondaryShare1"
    | "LooseCutLayerSecondaryShare2"
    | "LooseCutLayerSecondaryShare3"
    | "LooseCutLayerSecondaryShare4"
    | "LooseCutLayerSecondaryShare6"
    | "LooseCutLayerSecondaryShare7"
    | "LooseCutLayerSecondaryShare5"
    | "RockLayerStrength0"
    | "RockLayerStrength1"
    | "RockLayerStrength2"
    | "RockLayerStrength3"
    | "RockLayerStrength4"
    | "RockLayerStrength6"
    | "RockLayerStrength7"
    | "RockLayerStrength5"
    | "RockCutLayerStrength0"
    | "RockCutLayerStrength1"
    | "RockCutLayerStrength2"
    | "RockCutLayerStrength3"
    | "RockCutLayerStrength4"
    | "RockCutLayerStrength6"
    | "RockCutLayerStrength7"
    | "RockCutLayerStrength5"
    | "LooseLayerStrength0"
    | "LooseLayerStrength1"
    | "LooseLayerStrength2"
    | "LooseLayerStrength3"
    | "LooseLayerStrength4"
    | "LooseLayerStrength6"
    | "LooseLayerStrength7"
    | "LooseLayerStrength5"
    | "LooseCutLayerStrength0"
    | "LooseCutLayerStrength1"
    | "LooseCutLayerStrength2"
    | "LooseCutLayerStrength3"
    | "LooseCutLayerStrength4"
    | "LooseCutLayerStrength6"
    | "LooseCutLayerStrength7"
    | "LooseCutLayerStrength5"
    | "RockLayerDamage0"
    | "RockLayerDamage1"
    | "RockLayerDamage2"
    | "RockLayerDamage3"
    | "RockLayerDamage4"
    | "RockLayerDamage6"
    | "RockLayerDamage7"
    | "RockLayerDamage5"
    | "RockCutLayerDamage0"
    | "RockCutLayerDamage1"
    | "RockCutLayerDamage2"
    | "RockCutLayerDamage3"
    | "RockCutLayerDamage4"
    | "RockCutLayerDamage6"
    | "RockCutLayerDamage7"
    | "RockCutLayerDamage5"
    | "LooseLayerDamage0"
    | "LooseLayerDamage1"
    | "LooseLayerDamage2"
    | "LooseLayerDamage3"
    | "LooseLayerDamage4"
    | "LooseLayerDamage6"
    | "LooseLayerDamage7"
    | "LooseLayerDamage5"
    | "LooseCutLayerDamage0"
    | "LooseCutLayerDamage1"
    | "LooseCutLayerDamage2"
    | "LooseCutLayerDamage3"
    | "LooseCutLayerDamage4"
    | "LooseCutLayerDamage6"
    | "LooseCutLayerDamage7"
    | "LooseCutLayerDamage5"
    | "RockLayerGrainX0"
    | "RockLayerGrainX1"
    | "RockLayerGrainX2"
    | "RockLayerGrainX3"
    | "RockLayerGrainX4"
    | "RockLayerGrainX6"
    | "RockLayerGrainX7"
    | "RockLayerGrainX5"
    | "RockCutLayerGrainX0"
    | "RockCutLayerGrainX1"
    | "RockCutLayerGrainX2"
    | "RockCutLayerGrainX3"
    | "RockCutLayerGrainX4"
    | "RockCutLayerGrainX6"
    | "RockCutLayerGrainX7"
    | "RockCutLayerGrainX5"
    | "LooseLayerGrainX0"
    | "LooseLayerGrainX1"
    | "LooseLayerGrainX2"
    | "LooseLayerGrainX3"
    | "LooseLayerGrainX4"
    | "LooseLayerGrainX6"
    | "LooseLayerGrainX7"
    | "LooseLayerGrainX5"
    | "LooseCutLayerGrainX0"
    | "LooseCutLayerGrainX1"
    | "LooseCutLayerGrainX2"
    | "LooseCutLayerGrainX3"
    | "LooseCutLayerGrainX4"
    | "LooseCutLayerGrainX6"
    | "LooseCutLayerGrainX7"
    | "LooseCutLayerGrainX5"
    | "RockLayerGrainY0"
    | "RockLayerGrainY1"
    | "RockLayerGrainY2"
    | "RockLayerGrainY3"
    | "RockLayerGrainY4"
    | "RockLayerGrainY6"
    | "RockLayerGrainY7"
    | "RockLayerGrainY5"
    | "RockCutLayerGrainY0"
    | "RockCutLayerGrainY1"
    | "RockCutLayerGrainY2"
    | "RockCutLayerGrainY3"
    | "RockCutLayerGrainY4"
    | "RockCutLayerGrainY6"
    | "RockCutLayerGrainY7"
    | "RockCutLayerGrainY5"
    | "LooseLayerGrainY0"
    | "LooseLayerGrainY1"
    | "LooseLayerGrainY2"
    | "LooseLayerGrainY3"
    | "LooseLayerGrainY4"
    | "LooseLayerGrainY6"
    | "LooseLayerGrainY7"
    | "LooseLayerGrainY5"
    | "LooseCutLayerGrainY0"
    | "LooseCutLayerGrainY1"
    | "LooseCutLayerGrainY2"
    | "LooseCutLayerGrainY3"
    | "LooseCutLayerGrainY4"
    | "LooseCutLayerGrainY6"
    | "LooseCutLayerGrainY7"
    | "LooseCutLayerGrainY5"
    | "RockLayerBedSlopeX0"
    | "RockLayerBedSlopeX1"
    | "RockLayerBedSlopeX2"
    | "RockLayerBedSlopeX3"
    | "RockLayerBedSlopeX4"
    | "RockLayerBedSlopeX6"
    | "RockLayerBedSlopeX7"
    | "RockLayerBedSlopeX5"
    | "RockCutLayerBedSlopeX0"
    | "RockCutLayerBedSlopeX1"
    | "RockCutLayerBedSlopeX2"
    | "RockCutLayerBedSlopeX3"
    | "RockCutLayerBedSlopeX4"
    | "RockCutLayerBedSlopeX6"
    | "RockCutLayerBedSlopeX7"
    | "RockCutLayerBedSlopeX5"
    | "LooseLayerBedSlopeX0"
    | "LooseLayerBedSlopeX1"
    | "LooseLayerBedSlopeX2"
    | "LooseLayerBedSlopeX3"
    | "LooseLayerBedSlopeX4"
    | "LooseLayerBedSlopeX6"
    | "LooseLayerBedSlopeX7"
    | "LooseLayerBedSlopeX5"
    | "LooseCutLayerBedSlopeX0"
    | "LooseCutLayerBedSlopeX1"
    | "LooseCutLayerBedSlopeX2"
    | "LooseCutLayerBedSlopeX3"
    | "LooseCutLayerBedSlopeX4"
    | "LooseCutLayerBedSlopeX6"
    | "LooseCutLayerBedSlopeX7"
    | "LooseCutLayerBedSlopeX5"
    | "RockLayerBedSlopeY0"
    | "RockLayerBedSlopeY1"
    | "RockLayerBedSlopeY2"
    | "RockLayerBedSlopeY3"
    | "RockLayerBedSlopeY4"
    | "RockLayerBedSlopeY6"
    | "RockLayerBedSlopeY7"
    | "RockLayerBedSlopeY5"
    | "RockCutLayerBedSlopeY0"
    | "RockCutLayerBedSlopeY1"
    | "RockCutLayerBedSlopeY2"
    | "RockCutLayerBedSlopeY3"
    | "RockCutLayerBedSlopeY4"
    | "RockCutLayerBedSlopeY6"
    | "RockCutLayerBedSlopeY7"
    | "RockCutLayerBedSlopeY5"
    | "LooseLayerBedSlopeY0"
    | "LooseLayerBedSlopeY1"
    | "LooseLayerBedSlopeY2"
    | "LooseLayerBedSlopeY3"
    | "LooseLayerBedSlopeY4"
    | "LooseLayerBedSlopeY6"
    | "LooseLayerBedSlopeY7"
    | "LooseLayerBedSlopeY5"
    | "LooseCutLayerBedSlopeY0"
    | "LooseCutLayerBedSlopeY1"
    | "LooseCutLayerBedSlopeY2"
    | "LooseCutLayerBedSlopeY3"
    | "LooseCutLayerBedSlopeY4"
    | "LooseCutLayerBedSlopeY6"
    | "LooseCutLayerBedSlopeY7"
    | "LooseCutLayerBedSlopeY5"
    | "RockLayerDeposited0"
    | "RockLayerDeposited1"
    | "RockLayerDeposited2"
    | "RockLayerDeposited3"
    | "RockLayerDeposited4"
    | "RockLayerDeposited6"
    | "RockLayerDeposited7"
    | "RockLayerDeposited5"
    | "RockCutLayerDeposited0"
    | "RockCutLayerDeposited1"
    | "RockCutLayerDeposited2"
    | "RockCutLayerDeposited3"
    | "RockCutLayerDeposited4"
    | "RockCutLayerDeposited6"
    | "RockCutLayerDeposited7"
    | "RockCutLayerDeposited5"
    | "LooseLayerDeposited0"
    | "LooseLayerDeposited1"
    | "LooseLayerDeposited2"
    | "LooseLayerDeposited3"
    | "LooseLayerDeposited4"
    | "LooseLayerDeposited6"
    | "LooseLayerDeposited7"
    | "LooseLayerDeposited5"
    | "LooseCutLayerDeposited0"
    | "LooseCutLayerDeposited1"
    | "LooseCutLayerDeposited2"
    | "LooseCutLayerDeposited3"
    | "LooseCutLayerDeposited4"
    | "LooseCutLayerDeposited6"
    | "LooseCutLayerDeposited7"
    | "LooseCutLayerDeposited5"
    | "RockLayerConsolidation0"
    | "RockLayerConsolidation1"
    | "RockLayerConsolidation2"
    | "RockLayerConsolidation3"
    | "RockLayerConsolidation4"
    | "RockLayerConsolidation6"
    | "RockLayerConsolidation7"
    | "RockLayerConsolidation5"
    | "RockCutLayerConsolidation0"
    | "RockCutLayerConsolidation1"
    | "RockCutLayerConsolidation2"
    | "RockCutLayerConsolidation3"
    | "RockCutLayerConsolidation4"
    | "RockCutLayerConsolidation6"
    | "RockCutLayerConsolidation7"
    | "RockCutLayerConsolidation5"
    | "LooseLayerConsolidation0"
    | "LooseLayerConsolidation1"
    | "LooseLayerConsolidation2"
    | "LooseLayerConsolidation3"
    | "LooseLayerConsolidation4"
    | "LooseLayerConsolidation6"
    | "LooseLayerConsolidation7"
    | "LooseLayerConsolidation5"
    | "LooseCutLayerConsolidation0"
    | "LooseCutLayerConsolidation1"
    | "LooseCutLayerConsolidation2"
    | "LooseCutLayerConsolidation3"
    | "LooseCutLayerConsolidation4"
    | "LooseCutLayerConsolidation6"
    | "LooseCutLayerConsolidation7"
    | "LooseCutLayerConsolidation5"
    | "RockLayerFormedMin0"
    | "RockLayerFormedMin1"
    | "RockLayerFormedMin2"
    | "RockLayerFormedMin3"
    | "RockLayerFormedMin4"
    | "RockLayerFormedMin6"
    | "RockLayerFormedMin7"
    | "RockLayerFormedMin5"
    | "RockCutLayerFormedMin0"
    | "RockCutLayerFormedMin1"
    | "RockCutLayerFormedMin2"
    | "RockCutLayerFormedMin3"
    | "RockCutLayerFormedMin4"
    | "RockCutLayerFormedMin6"
    | "RockCutLayerFormedMin7"
    | "RockCutLayerFormedMin5"
    | "LooseLayerFormedMin0"
    | "LooseLayerFormedMin1"
    | "LooseLayerFormedMin2"
    | "LooseLayerFormedMin3"
    | "LooseLayerFormedMin4"
    | "LooseLayerFormedMin6"
    | "LooseLayerFormedMin7"
    | "LooseLayerFormedMin5"
    | "LooseCutLayerFormedMin0"
    | "LooseCutLayerFormedMin1"
    | "LooseCutLayerFormedMin2"
    | "LooseCutLayerFormedMin3"
    | "LooseCutLayerFormedMin4"
    | "LooseCutLayerFormedMin6"
    | "LooseCutLayerFormedMin7"
    | "LooseCutLayerFormedMin5"
    | "RockLayerFormedMax0"
    | "RockLayerFormedMax1"
    | "RockLayerFormedMax2"
    | "RockLayerFormedMax3"
    | "RockLayerFormedMax4"
    | "RockLayerFormedMax6"
    | "RockLayerFormedMax7"
    | "RockLayerFormedMax5"
    | "RockCutLayerFormedMax0"
    | "RockCutLayerFormedMax1"
    | "RockCutLayerFormedMax2"
    | "RockCutLayerFormedMax3"
    | "RockCutLayerFormedMax4"
    | "RockCutLayerFormedMax6"
    | "RockCutLayerFormedMax7"
    | "RockCutLayerFormedMax5"
    | "LooseLayerFormedMax0"
    | "LooseLayerFormedMax1"
    | "LooseLayerFormedMax2"
    | "LooseLayerFormedMax3"
    | "LooseLayerFormedMax4"
    | "LooseLayerFormedMax6"
    | "LooseLayerFormedMax7"
    | "LooseLayerFormedMax5"
    | "LooseCutLayerFormedMax0"
    | "LooseCutLayerFormedMax1"
    | "LooseCutLayerFormedMax2"
    | "LooseCutLayerFormedMax3"
    | "LooseCutLayerFormedMax4"
    | "LooseCutLayerFormedMax6"
    | "LooseCutLayerFormedMax7"
    | "LooseCutLayerFormedMax5"
    | "RockLayerAltered0"
    | "RockLayerAltered1"
    | "RockLayerAltered2"
    | "RockLayerAltered3"
    | "RockLayerAltered4"
    | "RockLayerAltered6"
    | "RockLayerAltered7"
    | "RockLayerAltered5"
    | "RockCutLayerAltered0"
    | "RockCutLayerAltered1"
    | "RockCutLayerAltered2"
    | "RockCutLayerAltered3"
    | "RockCutLayerAltered4"
    | "RockCutLayerAltered6"
    | "RockCutLayerAltered7"
    | "RockCutLayerAltered5"
    | "LooseLayerAltered0"
    | "LooseLayerAltered1"
    | "LooseLayerAltered2"
    | "LooseLayerAltered3"
    | "LooseLayerAltered4"
    | "LooseLayerAltered6"
    | "LooseLayerAltered7"
    | "LooseLayerAltered5"
    | "LooseCutLayerAltered0"
    | "LooseCutLayerAltered1"
    | "LooseCutLayerAltered2"
    | "LooseCutLayerAltered3"
    | "LooseCutLayerAltered4"
    | "LooseCutLayerAltered6"
    | "LooseCutLayerAltered7"
    | "LooseCutLayerAltered5"
  )[],
  "GroundLoadVolume",
  "GroundLoadSecondaryShare",
  "GroundLoadStrength",
  "GroundLoadDamage",
  "GroundLoadGrainX",
  "GroundLoadGrainY",
  "GroundLoadBedSlopeX",
  "GroundLoadBedSlopeY",
  "GroundLoadDeposited",
  "GroundLoadConsolidation",
  "GroundLoadFormedMin",
  "GroundLoadFormedMax",
  "GroundLoadAltered",
  "SeaLoadVolume",
  "SeaLoadSecondaryShare",
  "SeaLoadStrength",
  "SeaLoadDamage",
  "SeaLoadGrainX",
  "SeaLoadGrainY",
  "SeaLoadBedSlopeX",
  "SeaLoadBedSlopeY",
  "SeaLoadDeposited",
  "SeaLoadConsolidation",
  "SeaLoadFormedMin",
  "SeaLoadFormedMax",
  "SeaLoadAltered",
  "GroundCutDepth",
  "GroundCutCover",
  "Elevation",
  "BedrockElevation",
  "CrustThickness",
  "CrustSupportElevation",
  "CrustSupportTarget",
  "SurfaceRockLoad",
  "SedimentThickness",
  "SedimentSupply",
  "CumulativeFluvialErosion",
  "CumulativeGlacialErosion",
  "CumulativeGlacialDeposition",
  "CumulativeCoastalErosion",
  "CumulativeDeposition",
  "OrogenicConstruction",
  "ConvergentCrustSurplus",
  "CrustContinentalColumn",
  "CrustRootReserve",
  "OceanicSubduction",
  "OceanicSubductionHistory",
  "ImpactExcavation",
  "ImpactRimUplift",
  "ImpactEjectaThickness",
  "VolcanicConstructionHistory",
  "VolcanicMeltSupply",
  "LandmarkMaintenance",
  "Slope",
  "WaterDepths",
  "WaterSurfaceElevations",
  "DrainageElevations",
  "LakeOverflow",
];
declare const floatFields: readonly ["RidgeInfluence", "Uplift"];
declare const metricFields: readonly [
  "GroundCutShare",
  "TreeCover",
  "GrassCover",
  "WetlandCover",
  "FireActivity",
  "BroadleafCover",
  "ConiferCover",
  "BroadleafSaplings",
  "ConiferSaplings",
  "GrassSeed",
  "BroadleafSeed",
  "ConiferSeed",
  "WetlandSeed",
  "EcologicalDamage",
  "EcologicalToxicity",
  "Infiltration",
  "SoilCarbon",
  "PeatCarbon",
  "AquaticCarbon",
  "BuriedPlantCarbon",
  "BuriedAquaticCarbon",
  "CoalCarbon",
  "OilCarbon",
  "GasCarbon",
  "EcologySediment",
  "EcologyVolcanic",
  "EcologyImpact",
  "EcologyErosion",
  "EcologyIce",
  "Grazers",
  "Browsers",
  "SoilDepth",
  "SoilWater",
  "MineralNutrients",
  "CanopyAge",
  "MigrationFlux",
  "FloodFrequency",
  "Evapotranspiration",
  "Productivity",
  "AquaticProductivity",
  "Herbivores",
  "Predators",
  "AquaticFauna",
  "OrganicBurialDepth",
  "OrganicMaturity",
  "EcologyStillness",
  "OceanMarginDistance",
  "CrustRiftStrain",
  "CrustRiftAgeMyr",
  "OceanDistance",
  "Seasonality",
  "AirDemand",
  "WindSpeed",
  "Rainfall",
  "Snowfall",
  "GlacialMeltwater",
  "ExternalMeltwater",
  "GroundwaterStorage",
  "GroundwaterExchangeVolume",
  "GroundwaterRecharge",
  "GroundwaterOutflow",
  "GroundwaterReturn",
  "OrganicBurialInput",
  "OrganicBurialThickness",
  "Runoff",
  "FloodRunoff",
  "DryRunoff",
  "WaterRecharge",
  "SeepageRecharge",
  "SnowKept",
  "SnowPack",
  "ColumnPrecipitation",
  "FlowAccumulation",
  "SmallChannelLength",
  "FloodFlow",
  "PerennialFlow",
  "FlowingMonths",
  ...(
    | "RuinedBuiltUp"
    | "RuinedStanding"
    | "RuinCover"
    | "IdentityPeople0"
    | "IdentityPeople1"
    | "IdentityPeople2"
    | "IdentityPeople3"
    | "IdentityHardness0"
    | "IdentityHardness1"
    | "IdentityHardness2"
    | "IdentityHardness3"
    | "IdentityAge0"
    | "IdentityAge1"
    | "IdentityAge2"
    | "IdentityAge3"
    | "SurfaceWaterMonth0"
    | "SurfaceWaterMonth1"
    | "SurfaceWaterMonth2"
    | "SurfaceWaterMonth3"
    | "SurfaceWaterMonth4"
    | "SurfaceWaterMonth6"
    | "SurfaceWaterMonth7"
    | "SurfaceWaterMonth8"
    | "SurfaceWaterMonth5"
    | "SurfaceWaterMonth9"
    | "SurfaceWaterMonth10"
    | "SurfaceWaterMonth11"
    | "CatchmentArea"
    | "RiverWidth"
    | "RiverDepth"
    | "IceFlux"
    | "MaximumIceFlux"
    | "MaximumGroundedIceFlux"
    | "IceThickness"
    | "IceRetreat"
    | "MaximumIceThickness"
    | "Quickening"
    | "Stillness"
    | "IcePersistence"
    | "IceCharge"
    | "ExternalUpwelling"
    | "ExternalSeaSurfaceForcing"
    | "FogForcing"
    | "StormForcing"
    | "StormTrack"
    | "FirstEpochHeight"
    | "Verdure"
    | "Tenure"
    | "WalkedRoute"
    | "MassDeath"
    | "Salting"
    | "LakeMemory"
    | "Warding"
    | "KeptLine"
    | "Tearing"
    | "RiverWarmth"
    | "Population"
    | "Farmland"
    | "Pasture"
    | "BuiltUp"
    | "Standing"
  )[],
];
export type PhysicalIntegerName = (typeof integerFields)[number];
export type PhysicalFieldName =
  | PhysicalIntegerName
  | (typeof elevationFields)[number]
  | (typeof metricFields)[number]
  | (typeof floatFields)[number];
/** The physical schema: every channel's sample type and initial value. */
export declare function canonicalPhysicalFields(): {
  name: PhysicalFieldName;
  type: SampleType;
  lifetime: "run";
  initial: number;
}[];
export {};
