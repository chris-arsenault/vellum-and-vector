// Generated dimensions are fractions resolved by the owning map's MapScale. Resolved
// lengths are metres, areas m², discharge m³/s, ice flux m³/year and slopes rise/run.
// Temperature remains ten native units per °C with zero °C at 300.
import { rockCatalogue } from "../rock/rockCatalogue";
import { coastSettings } from "../processes/coastSettings";
import { iceSettings } from "../processes/iceSettings";
import { slopeSettings } from "../processes/slopeSettings";
import { weatheringSettings } from "../processes/weatheringSettings";
import { creepSettings } from "../processes/creepSettings";
import { solutionSettings } from "../processes/solutionSettings";
import { streamSettings } from "../processes/streamSettings";
import { lavaSettings } from "../processes/lavaSettings";
import { marineSettings } from "../processes/marineSettings";
import { MapScale, type ResolvedSettings } from "@atlas/domain";

// Fractions/strengths explicitly named PerMille (and legacy scalar strengths)
// remain dimensionless; iterations count numerical passes within one epoch.
export const physicalProfile = MapScale.definitions({
  BoundaryPadding: MapScale.length(0.025),
  ElevationScale: MapScale.length(0.00025),
  TectonicProvinceCount: 14,
  TectonicSiteCandidateMultiplier: 24,
  ContinentalAssemblyCount: 3,
  // Cohesion of assembly seeds within compound continental regions; zero disperses them.
  ContinentalAssemblyClustering: 1,
  // Relative variation in initial assembly area budgets; motion stays coherent within each.
  ContinentalAssemblyGrowthVariation: 0.8,
  // How many assemblies start with a larger share of the land, and how much larger: a tendency
  // towards a few main continents and smaller ones, which history is free to rearrange.
  ContinentalMajorAssemblies: 2,
  ContinentalMajorGrowth: 2,
  // Plates of ocean crust alone, holding this share of the world's water between them.
  OceanicPlateCount: 2,
  OceanicPlateWaterShare: 0.5,
  ContinentalCrustFraction: 0.48,
  ContinentalTransitionWidth: MapScale.length(0.065),
  // length-unit: ratio — share of rift subsidence and crust potential, not a placed depth.
  ContinentalAssemblySeparationDepth: 0.38,
  ContinentalCrustPotentialFloor: 0.62,
  OceanicCrustPotentialCeiling: 0.38,
  ContinentalWarpScale: MapScale.length(0.135),
  ContinentalWarpStrength: MapScale.length(0.045),
  RidgeWidth: MapScale.length(0.0275),
  TectonicMotionMinimum: 0.22,
  TectonicMotionMaximum: 0.72,
  TectonicConvergenceThreshold: 0.12,
  ContinentalSutureDetectionReach: MapScale.length(0.015),
  ContinentalSutureMinimumFraction: 420,
  ContinentalSutureStrengthGain: 620,
  // How fast a plate moves at full tectonic strength, in metres per million years.
  PlateDriftPerMyr: MapScale.length(0.025),
  MarginInfluenceReach: MapScale.length(0.065),
  CrustAgeSaturationDistance: MapScale.length(0.175),
  OceanicSubsidenceDepth: MapScale.length(0.0003),
  // Thermal subsidence belongs to oceanic lithosphere: full at continental fraction 0, fading
  // linearly to none at this fraction, so an aged continental platform keeps its height.
  OceanicSubsidenceCompositionLimit: 0.5,
  ConvergentTrenchDepth: MapScale.length(0.000225),
  MarginEvolutionResponsePerMille: 760,
  CoastalDetailBand: MapScale.length(0.0000225),
  CoastalDetailStrength: 1000,
  CoastalDetailScale: MapScale.length(0.0175),
  CoastalDetailWarp: MapScale.length(0.0065),
  CoastalDetailPassiveAmplitude: MapScale.length(0.0000155),
  CoastalDetailConvergentAmplitude: MapScale.length(0.000022),
  CoastalDetailRiftedAmplitude: MapScale.length(0.0000185),
  CoastalDetailTransformAmplitude: MapScale.length(0.0000085),
  VolcanicRockResistance: rockCatalogue.basalt.resistance,
  FjordMinimumGlacialErosion: MapScale.length(5e-7),
  // Metres from a fjord's axis to the land on both of its flanks.
  FjordMaximumHalfWidth: MapScale.length(0.00375),
  // Hadley, Ferrel and polar cells between the equator and each pole.
  CirculationCellsPerHemisphere: 3,
  CirculationCellTurn: 700,
  CirculationWander: 550,
  CirculationWanderScale: MapScale.length(0.105),
  // Surface wind: mid-cell belt speeds (m/s), falling toward calm cell
  // boundaries, then shaped by terrain smoothed over WindTerrainLength.
  WindSpeedTrades: MapScale.length(0.00000175),
  WindSpeedWesterlies: MapScale.length(0.00000225),
  WindSpeedPolar: MapScale.length(0.00000125),
  WindLandRoughness: 0.75,
  WindTerrainLength: MapScale.length(0.01),
  WindBlockingHeight: MapScale.length(0.000375),
  WindBlockingSlope: 0.01,
  WindBlockingMaximum: 0.6,
  WindExposureRelief: MapScale.length(0.00015),
  WindShelterHeight: MapScale.length(0.00025),
  WindGapReach: MapScale.length(0.00625),
  WindGapRelief: MapScale.length(0.000075),
  ElevationVariationScale: MapScale.length(0.0625),
  ElevationVariationStrength: 0.12,
  InteriorReliefStrength: 0.2,
  InteriorReliefScale: MapScale.length(0.03),
  OrogenicMinimumComponentArea: MapScale.area(0.0000375),
  OrogenicMinimumStrain: 80,
  // Relief a child profile realizes below its parent's cell from the parent's own gradient:
  // amplitude is the gain times the parent cell's relief above the floor (metres), stretched
  // along the ridge direction by the anisotropy.
  ReliefSynthesisGain: 2,
  ReliefSynthesisFloor: MapScale.length(0.000015),
  ReliefSynthesisAnisotropy: 3,
  // Independent maps resolve rolling lowland relief as well as inherited mountain slopes.
  RegionalReliefMinimumSlope: 0.008,
  OrogenicAlongStrikeScale: MapScale.length(0.105),
  // The width of a thrust sheet in rock of baseline stiffness, and a fault segment's length.
  OrogenicSheetSpacing: MapScale.length(0.025),
  OrogenicSegmentLength: MapScale.length(0.065),
  // How far a belt has already shortened when the world first forms, standing in for the drift
  // of later passes; how far its front advances per metre of shortening; and how high a sheet's
  // leading edge climbs where it comes fully over the next sheet.
  OrogenicInitialShortening: MapScale.length(0.15),
  OrogenicAccretionRatio: 1,
  // How far a sheet's beds rise through the surface, and how far its leading edge climbs, per metre
  // of slip: the dip of a thrust's ramp.
  ThrustTiltGradient: 0.04,
  ThrustRampGradient: 0.04,
  OrogenicRockShare: 0.5,
  // Metres of crust above its normal thickness that a column bears before the rest starts to flow,
  // the excess at which half of what is over goes, and how far a pass's flow reaches.
  CrustFlowYield: MapScale.length(0.00075),
  CrustFlowEase: MapScale.length(0.0005),
  CrustFlowLength: MapScale.length(0.05),
  // What a full-strength seam rises per unit of span at full tectonic strength, under strain of one.
  // Hard collisions reach about a third of that strain.
  SutureReactivationPerSpan: MapScale.length(0.002),
  // How far out from a seam the crust is broken enough to take up that stress.
  SutureReactivationZone: MapScale.length(0.05),
  OrogenicCoreRockResistance: rockCatalogue.gneiss.resistance,
  ImpactOceanShockDepth: MapScale.length(0.00015),
  ImpactPrimordialShare: 620,
  PlumeLobeScale: MapScale.length(0.0225),
  PlumeLobeStrength: 620,
  InteriorBasinDepthShare: 260,
  EpochTectonicElevationStep: MapScale.length(0.00006),
  // Porous bulk sediment, not grain density; saturation/compaction do not yet vary this load.
  SedimentLoadResponsePerMille: 360,
  // Ice/asthenosphere density ratio: Le Meur & Huybrechts, doi:10.3189/S0260305500013586.
  IceLoadResponsePerMille: (1000 * 910) / 3300,
  LithosphericFlexureLength: MapScale.length(0.025),
  ...streamSettings,
  ...lavaSettings,
  ...marineSettings,
  ...solutionSettings,
  ...iceSettings,
  ...slopeSettings,
  ...weatheringSettings,
  ...creepSettings,
  ...coastSettings,
  SedimentTransportFraction: 760,
  SedimentDepositionLength: MapScale.length(0.0025),
  // What flowing water can carry, in cubic metres per square metre of catchment per unit of slope,
  // per unit of span. Past this it drops what it cannot carry.
  SedimentCarry: MapScale.length(0.025),
  ImpactCraterCount: 6,
  ImpactMinimumRadius: MapScale.length(0.0125),
  ImpactMaximumRadius: MapScale.length(0.045),
  ImpactMinimumSpacing: MapScale.length(0.055),
  // Per mille of ElevationScale at the largest radius; smaller craters keep (r/max)^0.3 of it,
  // the complex-crater depth/diameter scaling.
  ImpactDepthRatio: 1200,
  ImpactRimHeightRatio: 450,
  // Metres a crater's rim must still stand above its floor and surroundings to be mapped.
  ImpactVisibleRelief: MapScale.length(0.000025),
  ImpactEjectaFraction: 520,
  ImpactFractureStrength: 760,
  ImpactThermalRadiusThreshold: MapScale.length(0.03),
  // Ice-balance units gained per metre of height above the sea, on top of the lapse rate the
  // temperature field already carries. Zero lets climate alone decide; the reference value of
  // 0.25 glaciated every plateau above about 3,000 m in any climate and is kept for the
  // Glacier-carved terrain choice.
  IceAltitudeBalance: MapScale.inverseLength(0),
  IceAblationStep: MapScale.length(0.000065),
  FrozenLakeIceAdvanceGradient: 0.004,
  GlacierGroundingFraction: 900,
  GlacialMeltTemperatureFloor: 170,
  GlacialAblationRunoffStrength: 460,
  BasalMeltRunoffStrength: 180,
  GlacialRetreatRunoffStrength: 260,
  AncestralValleyMinimumErosion: MapScale.length(0.00000125),
  OutwashMinimumGlacialDeposition: MapScale.length(0.0000015),
  // Metres of terminus till that build a moraine under a flowing glacier's margin.
  MoraineMinimumGlacialDeposition: MapScale.length(0.0000025),
  // Metres of glacial erosion that carve a drainage line into a U-shaped trough.
  UValleyMinimumGlacialErosion: MapScale.length(0.000002),
  ImpactLandformMinimumExcavation: MapScale.length(0.0000045),
  ImpactLandformMinimumRimUplift: MapScale.length(0.000002),
  InheritedRidgeActivityThreshold: 60,
  CoastalErosionStrength: 180,
  CoastalActiveWidth: MapScale.length(0.0025),
  CoastalDepositionReach: MapScale.length(0.005),
  CoastalDepositionFraction: 580,
  CoastalSeaLevelChange: MapScale.length(0),
  SeaLevel: MapScale.length(0),
  ShelfDepth: MapScale.length(0.0000525),
  ShelfBreakDepth: MapScale.length(0.0001075),
  IslandAreaThreshold: MapScale.area(0.000625),
  LakeDepthThreshold: MapScale.length(0.00001125),
  MinimumLakeArea: MapScale.area(0.000003125),
  LakeCompactnessShare: 560,
  RunoffMinimumLossPerMille: 160,
  RunoffTemperatureLossPerMille: 420,
  LakeEvaporationMinimum: MapScale.length(4.5e-8, 1, "mm"),
  LakeEvaporationTemperatureStrength: MapScale.length(1.3e-7, 1, "mm"),
  LakeInfiltrationLoss: MapScale.length(3.5e-8, 1, "mm"),
  DrainageGuidanceLookaheadDistance: MapScale.length(0.03),
  DrainageFloorGradientWeight: 1000,
  DrainageConditionedGradientWeight: 450,
  DrainageOutletAlignmentWeight: 300,
  DrainageCaptureWeight: 900,
  DrainageInheritedValleyWeight: 450,
  RiverAccumulationThreshold: MapScale.volume(6.25e-19),
  RiverMinimumAccumulationThreshold: MapScale.volume(4.6875e-20),
  RiverBasinHeadwaterFraction: 80,
  RiverMinimumBasinDischarge: MapScale.volume(3.90625e-19),
  // World river vectors require a substantial basin, in annual mean m³/s.
  // Smaller physical channels still drive erosion, waterfalls and local landforms.
  WorldRiverMinimumBasinDischarge: MapScale.volume(5.46875e-18),
  ChannelReferenceSlope: 0.004,
  ChannelSlopeFloor: 350,
  ChannelSlopeCeiling: 2600,
  MinimumRiverReachLength: MapScale.length(0.0075),
  RiverChannelBaseStrength: 260,
  RiverChannelOrderStrength: 145,
  RiverChannelDischargeStrength: 55,
  RiverChannelWidthDecay: 330,
  RiverChannelWideningOrder: 2,
  RiverChannelWideningDischargeMultiplier: 5,
  RiverChannelMaximumLongitudinalAlignment: 560,
  RiverChannelMaximumBankRelief: MapScale.length(0.0000175),
  FloodplainMinimumRiverOrder: 2,
  FloodplainMaximumSlope: 0.0042,
  FloodplainMaximumRelief: MapScale.length(0.0000085),
  FloodplainMaximumLongitudinalAlignment: 720,
  FloodplainIntensityDecay: 280,
  DeltaMinimumRiverOrder: 2,
  DeltaDischargeMultiplier: 3,
  DeltaMinimumSedimentDelivery: MapScale.volume(1.5625e-12),
  DeltaMaximumWaveEnergy: 760,
  DeltaMaximumCurrentStrength: 900,
  DeltaIntensityDecay: 240,
  DeltaMinimumForwardAlignment: 80,
  // Degrees at the world's south and north edges. WorldExtentY is the world
  // frame's [south, north] in metres; null places the map at the mid latitude.
  // Projection 1 is equal-area (sin latitude linear in northing), 0 is linear.
  // WorldExtentX bounds the east–west wrap; WrapLongitude 1 joins its edges.
  LatitudeSouth: 10,
  LatitudeNorth: 70,
  LatitudeProjection: 1,
  WrapLongitude: 0,
  MapBoundary: 0,
  WorldExtentY: null as [number, number] | null,
  WorldExtentX: null as [number, number] | null,
  // Global mean at sea level; annual-mean insolation adds a second Legendre
  // term, -range × P2(sin latitude), which averages to zero over a sphere.
  TemperatureBaseline: 285,
  InsolationTemperatureRange: 280,
  ElevationTemperatureLapse: 65,
  // Seasonal half-range in °C: equatorial floor plus polar growth with sin²
  // latitude, reduced toward the coast over the continentality distance.
  SeasonalityEquator: 1.5,
  SeasonalityPolar: 22,
  MaritimeSeasonality: 0.35,
  ContinentalityDistance: MapScale.length(0.25),
  WarmthPocketCount: 15,
  WarmthPocketMinRadius: MapScale.length(0.025),
  WarmthPocketMaxRadius: MapScale.length(0.07),
  WarmthPocketMinStrength: 170,
  WarmthPocketMaxStrength: 390,
  HeartWarmthRadius: MapScale.length(0.07),
  HeartWarmthStrength: 310,
  // Geothermal intensity above the threshold warms the surface at this rate.
  GeothermalSurfaceThreshold: 0,
  GeothermalTemperatureStrength: 310,
  OceanCurrentSmoothingLength: MapScale.length(0.00625),
  // Boundary currents act within a few multiples of this distance from the
  // coast; western boundaries strengthen by up to the given share.
  GyreCoastalLength: MapScale.length(0.05),
  GyreBoundaryStrength: 0.8,
  // Surface water carries its source temperature, relaxing toward the local
  // equilibrium over this distance; full upwelling cools by UpwellingCooling.
  SeaSurfaceRelaxation: MapScale.length(0.3),
  UpwellingCooling: 60,
  // Eddy mixing length where opposing drifts meet, turning steps into fronts.
  SeaSurfaceMixing: MapScale.length(0.0625),
  OceanCurrentHeatDistance: MapScale.length(0.025),
  // Scalar heat-intensity units lost over the configured transport interval.
  OceanCurrentHeatCooling: 50,
  OceanCurrentFetchDistance: MapScale.length(0.045),
  OceanCurrentMinimumStrength: 110,
  OceanCurrentTemperatureStrength: 150,
  OceanCurrentWarmthStrength: 120,
  PrecipitationBaseline: MapScale.length(1e-8, 1, "mm"),
  // Downwind air columns (precipitation in mm/year). Over the
  // sea a column approaches OceanColumnHumidity of saturation, which grows by
  // ColumnSaturationGrowth per °C from ColumnSaturation at 20 °C. Over land it
  // rains out over ColumnRainLength and loses 1 − exp(−rise/OrographicLiftHeight)
  // to uplift; heat, maritime character and magical heat decay over their lengths.
  // Air relaxes toward MagicHeatAirShare of the magical forcing beneath it and
  // spreads that heat across the wind over MagicHeatAirSpread.
  ColumnSaturation: MapScale.length(4.125e-7, 1, "mm"),
  ColumnSaturationGrowth: 0.045,
  OceanColumnHumidity: 0.85,
  BoundaryColumnHumidity: 0.5,
  SeaEvaporationLength: MapScale.length(0.1),
  SeaExchangeLength: MapScale.length(0.075),
  ColumnRainLength: MapScale.length(0.25),
  ColumnRainEfficiency: 0.8,
  OrographicLiftHeight: MapScale.length(0.001),
  AirHeatLength: MapScale.length(0.25),
  MaritimeLength: MapScale.length(0.2),
  MagicHeatAirLength: MapScale.length(0.075),
  MagicHeatAirShare: 0.5,
  MagicHeatAirSpread: MapScale.length(0.015),
  // Hot ground is a moisture source and lifts the air over it: a column over strong
  // magical heat gains up to MagicSteamShare of its saturation deficit and wrings out
  // 1 − exp(−forcing/MagicLiftHeat) of its water, so the rain falls on the lee side.
  MagicSteamShare: 0.6,
  MagicLiftHeat: 250,
  // A storm pulse raised at sea relaxes over StormLength as the column travels, faster by
  // StormPinning where Aurora stills the air; it pushes the column toward saturation by
  // StormMoistureShare of the deficit and wrings out 1 − exp(−pulse/StormLift) of its water.
  StormLength: MapScale.length(0.1),
  StormPinning: 0.8,
  StormMoistureShare: 0.8,
  StormLift: 0.5,
  // On the track, soil thins by StormScour of itself at full pulse on a 1-in-20 slope and
  // bare ground loses DuneMobility of its sediment downwind.
  StormScour: 0.3,
  DuneMobility: 0.3,
  // A storm pulse is pinned by StormDeflection of the warding it crosses: Hallowed ground
  // turns the track aside, and the energy lands on the ring's rim.
  StormDeflection: 0.8,
  // A river carrying magical warmth loses WarmRiverEvaporation of its water to the air at
  // full warmth, so the closed lake it ends in gets less and dies sooner.
  WarmRiverEvaporation: 0.3,
  // Fog over an upwelling band drips onto the coast it faces (mm/year at full share)
  // and cools it (native units at full share).
  FogDrip: MapScale.length(7.5e-8, 1, "mm"),
  FogCooling: 20,
  // Pressure belts scale column rainout: convergence and the storm track raise
  // it, subtropical and polar subsidence lower it, never below MinimumRainout.
  // The equatorial convergence spreads over EquatorialConvergenceWidth degrees,
  // standing in for the seasonal migration of the rain belt.
  EquatorialConvergence: 1.2,
  // length-unit: degrees — latitude width of the atmospheric belt.
  EquatorialConvergenceWidth: 15,
  StormTrackStrength: 1.2,
  SubtropicalSubsidence: 1.1,
  // length-unit: degrees — latitude width of the atmospheric belt.
  SubtropicalSubsidenceWidth: 10,
  PolarSubsidence: 0.7,
  MinimumRainout: 0.08,
  SnowTemperatureThreshold: 300,
  SnowTemperatureTransition: 100,
  // Annual-mean surface temperature, after current and wave resistance, below
  // which open ocean carries sea ice.
  SeaIceFormationTemperature: 270,
  SeaIceCurrentResistance: 220,
  SeaIceWaveResistance: 180,
  SeaIceSuitabilityVariation: 150,
  SeaIceVariationScale: MapScale.length(0.065),
  RidgeElevationThreshold: MapScale.length(0.00025),
  RidgeSlopeThreshold: 0.0038,
  PeakElevationThreshold: MapScale.length(0.0003125),
  LandformNeighborhoodRadius: MapScale.length(0.0025),
  GorgeMinimumSlope: 0.009,
  GorgeMinimumIncision: MapScale.length(0.000003),
  // Mountain land: above the first height, or above the second with this much local relief.
  MountainElevation: MapScale.length(0.00025),
  HillElevation: MapScale.length(0.000125),
  MountainLocalRelief: MapScale.length(0.000075),
  // Metres from a cell to the terrain that measures its local relief and valley flanks.
  ReliefRadius: MapScale.length(0.00375),
  // Square metres of mountain land below which a range is left unnamed.
  RangeMinimumArea: MapScale.area(0.000125),
  CliffSlopeThreshold: 0.012,
  PlainSlopeThreshold: 0.003,
  IceTemperatureThreshold: 285,
  PermanentSeaIceTemperature: 205,
  IceMarginTemperature: 300,
  GlacierThicknessThreshold: MapScale.length(0.0000625),
  IceTransportYears: 1000,
  // Extra erosive power of sliding ice at full Aurora charge, per mille.
  ChargedIceErosion: 600,
  MinimumIceBalance: 80,
  GeothermalVentThreshold: 720,
  MantlePlumeCount: 3,
  MantlePlumeRadius: MapScale.length(0.0275),
  MantlePlumeMinimumSpacing: MapScale.length(0.09),
  MantlePlumeStrength: 940,
  MantlePlumeMinimumShare: 260,
  MantlePlumeStrengthExponent: 1700,
  // Reference dimensions determine plume supply volume; terrain and cooling determine its shape.
  VolcanicConeRadius: MapScale.length(0.015),
  VolcanicConeHeight: MapScale.length(0.00125),
  FractureBranchCount: 24,
  FractureMinimumLength: MapScale.length(0.045),
  FractureMaximumLength: MapScale.length(0.3),
  FractureMinimumSpacing: MapScale.length(0.045),
  FractureWidth: MapScale.length(0.0025),
  FractureConductanceFloor: 25,
  // Share of conductance above the floor that survives each later epoch.
  FractureRetentionPerSpan: 400,
  QualityTargets: {
    OceanCoverage: { target: 0.55, minimum: 0.38, maximum: 0.66 },
    InlandLakeBodyCount: { minimum: 2, maximum: 80 },
  },
});
export type PhysicalProfile = ResolvedSettings<typeof physicalProfile.values>;
