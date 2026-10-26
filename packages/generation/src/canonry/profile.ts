// Canonry process semantics, with physical atlas defaults. Lengths/heights are
// metres, areas m², water discharge m³/s, ice flux m³/year and slopes rise/run.
// Temperature remains ten native units per °C with zero °C at 300.
// Fractions/strengths explicitly named PerMille (and legacy scalar strengths)
// remain dimensionless; iterations count numerical passes within one epoch.
export const physicalProfile = {
  BoundaryPadding: 100_000,
  ElevationScale: 1000,
  TectonicProvinceCount: 14,
  TectonicSiteCandidateMultiplier: 24,
  ContinentalAssemblyCount: 4,
  // Cohesion of assembly seeds within compound continental regions; zero disperses them.
  ContinentalAssemblyClustering: 1,
  // Relative variation in initial assembly area budgets; motion stays coherent within each.
  ContinentalAssemblyGrowthVariation: 0.8,
  ContinentalCrustFraction: 0.35,
  ContinentalTransitionWidth: 260_000,
  ContinentalAssemblySeparationDepth: 0.38,
  ContinentalCrustPotentialFloor: 0.62,
  OceanicCrustPotentialCeiling: 0.38,
  ContinentalWarpScale: 540_000,
  ContinentalWarpStrength: 180_000,
  RidgeWidth: 110_000,
  TectonicMotionMinimum: 0.22,
  TectonicMotionMaximum: 0.72,
  TectonicConvergenceThreshold: 0.12,
  TectonicBoundaryPersistence: 420,
  ContinentalSutureDetectionReach: 60_000,
  ContinentalSutureMinimumFraction: 420,
  ContinentalSutureStrengthGain: 620,
  PlateDriftPerEpoch: 234_000,
  MarginInfluenceReach: 260_000,
  CrustAgeSaturationDistance: 700_000,
  OceanicSubsidenceDepth: 1200,
  // Thermal subsidence belongs to oceanic lithosphere: full at continental fraction 0, fading
  // linearly to none at this fraction, so an aged continental platform keeps its height.
  OceanicSubsidenceCompositionLimit: 0.5,
  PassiveShelfWidth: 240_000,
  RiftedShelfWidth: 160_000,
  ContinentalShelfDepth: 150,
  ConvergentTrenchDepth: 900,
  ContinentalRiseMinimumWidth: 240_000,
  PassiveMarginMaximumGradient: 0.0016,
  RiftedMarginMaximumGradient: 0.0018,
  MarginEvolutionResponsePerMille: 760,
  MarineSedimentCapacity: 180,
  CoastalDetailBand: 90,
  CoastalDetailStrength: 1000,
  CoastalDetailScale: 70_000,
  CoastalDetailWarp: 26_000,
  CoastalDetailPassiveAmplitude: 62,
  CoastalDetailConvergentAmplitude: 88,
  CoastalDetailRiftedAmplitude: 74,
  CoastalDetailTransformAmplitude: 34,
  VolcanicRockResistance: 2600,
  OrogenicRockResistance: 1500,
  SedimentRockWeakness: 900,
  SoftSedimentDepth: 45,
  FjordMinimumGlacialErosion: 2,
  // Metres from a fjord's axis to the land on both of its flanks.
  FjordMaximumHalfWidth: 15_000,
  // Hadley, Ferrel and polar cells between the equator and each pole.
  CirculationCellsPerHemisphere: 3,
  CirculationCellTurn: 700,
  CirculationWander: 550,
  CirculationWanderScale: 420_000,
  // Surface wind: mid-cell belt speeds (m/s), falling toward calm cell
  // boundaries, then shaped by terrain smoothed over WindTerrainLength.
  WindSpeedTrades: 7,
  WindSpeedWesterlies: 9,
  WindSpeedPolar: 5,
  WindLandRoughness: 0.75,
  WindTerrainLength: 40_000,
  WindBlockingHeight: 1500,
  WindBlockingSlope: 0.01,
  WindBlockingMaximum: 0.6,
  WindExposureRelief: 600,
  WindShelterHeight: 1000,
  WindGapReach: 25_000,
  WindGapRelief: 300,
  ElevationVariationScale: 250_000,
  ElevationVariationStrength: 0.12,
  InteriorReliefStrength: 0.2,
  InteriorReliefScale: 120_000,
  OrogenicMinimumComponentArea: 600_000_000,
  OrogenicMinimumStrain: 80,
  // Metres from a belt's boundary that construction reaches; it must cover the plateau.
  OrogenicInfluenceReach: 520_000,
  // Hinterland plateau: share of the crest section carried flat behind the belt, and the metres
  // behind the boundary over which it fades. The foreland front keeps this share of the range width.
  OrogenicPlateauWidth: 320_000,
  OrogenicPlateauShare: 0.6,
  OrogenicForelandWidthShare: 0.5,
  // Relief a child profile realizes below its parent's cell from the parent's own gradient:
  // amplitude is the gain times the parent cell's relief above the floor (metres), stretched
  // along the ridge direction by the anisotropy. Parent-cell means are conserved.
  ReliefSynthesisGain: 2,
  ReliefSynthesisFloor: 60,
  ReliefSynthesisAnisotropy: 3,
  InitialOrogenicConstructionStep: 3200,
  EpochOrogenicConstructionStep: 1200,
  CollisionRangeWidth: 180_000,
  SubductionRangeWidth: 100_000,
  RiftShoulderDistance: 70_000,
  TransformRangeWidth: 40_000,
  OrogenicAlongStrikeScale: 420_000,
  OrogenicProminenceMinimum: 700,
  OrogenicProminenceMaximum: 1900,
  OrogenicProminenceRankDecay: 2.4,
  OrogenicRootBudgetMinimum: 1200,
  OrogenicRootBudgetMaximum: 4000,
  OrogenicSurfaceReliefSharePerMille: 750,
  MaximumOrogenicSurfaceReliefPerPass: 1400,
  OrogenicCoreRockResistance: 2200,
  ContinentalRiftThinningBudget: 850,
  ImpactOceanShockDepth: 600,
  ImpactPrimordialShare: 620,
  PlumeLobeScale: 90_000,
  PlumeLobeStrength: 620,
  InteriorBasinDepthShare: 260,
  EpochTectonicElevationStep: 240,
  BedrockLoadResponsePerMille: 280,
  SedimentLoadResponsePerMille: 360,
  IceLoadResponsePerMille: 860,
  LithosphericFlexureLength: 35_000,
  MassWastingIterations: 4,
  PostFluvialMassWastingIterations: 2,
  // Rise/run: about 35 degrees for baseline rock, varied by material resistance.
  MassWastingStableGradient: 0.7,
  MassWastingTransportLength: 10_000,
  MassWastingTransportFraction: 280,
  // Cubic metres per metre of contour width in one physical relaxation pass.
  MaximumHillslopeTransport: 550_000,
  FluvialErosionIterations: 13,
  FluvialErosionStrength: 0.32,
  FluvialEquilibriumGradient: 0.0008,
  // Square metres of catchment before stream power incises; smaller areas are hillslope.
  FluvialChannelArea: 1e9,
  SedimentTransportFraction: 760,
  SedimentDepositionLength: 10_000,
  SedimentDepositionSlopeThreshold: 0.0034,
  MaximumSedimentDepositionPerPass: 18,
  ImpactCraterCount: 6,
  ImpactMinimumRadius: 50_000,
  ImpactMaximumRadius: 180_000,
  ImpactMinimumSpacing: 220_000,
  // Per mille of ElevationScale at the largest radius; smaller craters keep (r/max)^0.3 of it,
  // the complex-crater depth/diameter scaling.
  ImpactDepthRatio: 1200,
  ImpactRimHeightRatio: 450,
  // Metres a crater's rim must still stand above its floor and surroundings to be mapped.
  ImpactVisibleRelief: 100,
  ImpactEjectaFraction: 520,
  ImpactFractureStrength: 760,
  ImpactThermalRadiusThreshold: 120_000,
  // Ice-balance units gained per metre of height above the sea, on top of the lapse rate the
  // temperature field already carries. Zero lets climate alone decide; the reference value of
  // 0.25 glaciated every plateau above about 3,000 m in any climate and is kept for the
  // Glacier-carved terrain choice.
  IceAltitudeBalance: 0,
  IceAccumulationStep: 420,
  IceAblationStep: 260,
  FrozenLakeIceAdvanceGradient: 0.004,
  GlacierGroundingFraction: 900,
  GlacialMeltTemperatureFloor: 170,
  GlacialAblationRunoffStrength: 460,
  BasalMeltRunoffStrength: 180,
  GlacialRetreatRunoffStrength: 260,
  MaximumGlacialErosionPerPass: 18,
  MaximumGlacialDepositionPerPass: 20,
  AncestralValleyMinimumErosion: 5,
  OutwashMinimumGlacialDeposition: 6,
  // Metres of terminus till that build a moraine under a flowing glacier's margin.
  MoraineMinimumGlacialDeposition: 10,
  // Metres of glacial erosion that carve a drainage line into a U-shaped trough.
  UValleyMinimumGlacialErosion: 8,
  ImpactLandformMinimumExcavation: 18,
  ImpactLandformMinimumRimUplift: 8,
  InheritedRidgeActivityThreshold: 60,
  CoastalErosionWaveThreshold: 420,
  CoastalErosionStrength: 180,
  CoastalActiveWidth: 10_000,
  CoastalDepositionReach: 20_000,
  MaximumCoastalErosionPerPass: 12,
  CoastalDepositionFraction: 580,
  CoastalSeaLevelChange: 0,
  SeaLevel: 0,
  ShelfDepth: 210,
  ShelfBreakDepth: 430,
  IslandAreaThreshold: 10_000_000_000,
  LakeDepthThreshold: 45,
  MinimumLakeArea: 50_000_000,
  LakeCompactnessShare: 560,
  RunoffMinimumLossPerMille: 160,
  RunoffTemperatureLossPerMille: 420,
  LakeEvaporationMinimum: 180,
  LakeEvaporationTemperatureStrength: 520,
  LakeInfiltrationLoss: 140,
  LakeOutletOverflowScale: 400,
  MaximumLakeOutletIncisionPerPass: 140,
  LakeOutletIncisionSearchDistance: 120_000,
  DrainageGuidanceLookaheadDistance: 120_000,
  DrainageFloorGradientWeight: 1000,
  DrainageConditionedGradientWeight: 450,
  DrainageOutletAlignmentWeight: 300,
  DrainageCaptureWeight: 900,
  DrainageInheritedValleyWeight: 450,
  RiverAccumulationThreshold: 40,
  RiverMinimumAccumulationThreshold: 3,
  RiverBasinHeadwaterFraction: 80,
  RiverMinimumBasinDischarge: 25,
  // World river vectors require a substantial basin, in annual mean m³/s.
  // Smaller physical channels still drive erosion, waterfalls and local landforms.
  WorldRiverMinimumBasinDischarge: 350,
  ChannelReferenceSlope: 0.004,
  ChannelSlopeFloor: 350,
  ChannelSlopeCeiling: 2600,
  MinimumRiverReachLength: 30_000,
  // Metres a first-order headwater reach must run before the map publishes it.
  MappedHeadwaterMinimumLength: 60_000,
  RiverChannelBaseStrength: 260,
  RiverChannelOrderStrength: 145,
  RiverChannelDischargeStrength: 55,
  RiverChannelWidthDecay: 330,
  RiverChannelWideningOrder: 2,
  RiverChannelWideningDischargeMultiplier: 5,
  RiverChannelMaximumWidth: 20_000,
  RiverChannelMaximumLongitudinalAlignment: 560,
  RiverChannelMaximumBankRelief: 70,
  FloodplainMinimumRiverOrder: 2,
  FloodplainMaximumSlope: 0.0042,
  FloodplainMaximumRelief: 34,
  FloodplainMaximumLongitudinalAlignment: 720,
  FloodplainIntensityDecay: 280,
  FloodplainMaximumWidth: 15_000,
  DeltaMinimumRiverOrder: 2,
  DeltaDischargeMultiplier: 3,
  DeltaMinimumSedimentDelivery: 100_000_000,
  DeltaMaximumWaveEnergy: 760,
  DeltaMaximumCurrentStrength: 900,
  DeltaIntensityDecay: 240,
  DeltaMinimumForwardAlignment: 80,
  DeltaMaximumRadius: 30_000,
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
  ContinentalityDistance: 1_000_000,
  WarmthPocketCount: 15,
  WarmthPocketMinRadius: 100_000,
  WarmthPocketMaxRadius: 280_000,
  WarmthPocketMinStrength: 170,
  WarmthPocketMaxStrength: 390,
  HeartWarmthRadius: 280_000,
  HeartWarmthStrength: 310,
  // Geothermal intensity above the threshold warms the surface at this rate.
  GeothermalSurfaceThreshold: 0,
  GeothermalTemperatureStrength: 310,
  OceanCurrentSmoothingLength: 25_000,
  // Boundary currents act within a few multiples of this distance from the
  // coast; western boundaries strengthen by up to the given share.
  GyreCoastalLength: 200_000,
  GyreBoundaryStrength: 0.8,
  // Surface water carries its source temperature, relaxing toward the local
  // equilibrium over this distance; full upwelling cools by UpwellingCooling.
  SeaSurfaceRelaxation: 1_200_000,
  UpwellingCooling: 60,
  // Eddy mixing length where opposing drifts meet, turning steps into fronts;
  // never more than SeaSurfaceMixingDegrees of latitude on a compressed map.
  SeaSurfaceMixing: 250_000,
  SeaSurfaceMixingDegrees: 6,
  OceanCurrentHeatDistance: 100_000,
  // Scalar heat-intensity units lost over the configured transport interval.
  OceanCurrentHeatCooling: 50,
  OceanCurrentFetchDistance: 180_000,
  OceanCurrentMinimumStrength: 110,
  OceanCurrentTemperatureStrength: 150,
  OceanCurrentWarmthStrength: 120,
  PrecipitationBaseline: 40,
  // Precipitation and runoff are millimetres per year, up to this ceiling.
  PrecipitationCeiling: 4000,
  // Downwind air columns (precipitation in mm/year). Over the
  // sea a column approaches OceanColumnHumidity of saturation, which grows by
  // ColumnSaturationGrowth per °C from ColumnSaturation at 20 °C. Over land it
  // rains out over ColumnRainLength and loses 1 − exp(−rise/OrographicLiftHeight)
  // to uplift; heat, maritime character and magical heat decay over their lengths.
  // Air relaxes toward MagicHeatAirShare of the magical forcing beneath it and
  // spreads that heat across the wind over MagicHeatAirSpread.
  ColumnSaturation: 1650,
  ColumnSaturationGrowth: 0.045,
  OceanColumnHumidity: 0.85,
  BoundaryColumnHumidity: 0.5,
  SeaEvaporationLength: 400_000,
  SeaExchangeLength: 300_000,
  ColumnRainLength: 1_000_000,
  ColumnRainEfficiency: 0.8,
  OrographicLiftHeight: 4000,
  AirHeatLength: 1_000_000,
  MaritimeLength: 800_000,
  MagicHeatAirLength: 300_000,
  MagicHeatAirShare: 0.5,
  MagicHeatAirSpread: 60_000,
  // Hot ground is a moisture source and lifts the air over it: a column over strong
  // magical heat gains up to MagicSteamShare of its saturation deficit and wrings out
  // 1 − exp(−forcing/MagicLiftHeat) of its water, so the rain falls on the lee side.
  MagicSteamShare: 0.6,
  MagicLiftHeat: 250,
  // A storm pulse raised at sea relaxes over StormLength as the column travels, faster by
  // StormPinning where Aurora stills the air; it pushes the column toward saturation by
  // StormMoistureShare of the deficit and wrings out 1 − exp(−pulse/StormLift) of its water.
  StormLength: 400_000,
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
  FogDrip: 300,
  FogCooling: 20,
  // Pressure belts scale column rainout: convergence and the storm track raise
  // it, subtropical and polar subsidence lower it, never below MinimumRainout.
  // The equatorial convergence spreads over EquatorialConvergenceWidth degrees,
  // standing in for the seasonal migration of the rain belt.
  EquatorialConvergence: 1.2,
  EquatorialConvergenceWidth: 15,
  StormTrackStrength: 1.2,
  SubtropicalSubsidence: 1.1,
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
  SeaIceVariationScale: 260_000,
  RidgeElevationThreshold: 1000,
  RidgeSlopeThreshold: 0.0038,
  PeakElevationThreshold: 1250,
  WaterfallMinimumDrop: 45,
  WaterfallEvaluationLength: 1000,
  LandformNeighborhoodRadius: 10_000,
  GorgeMinimumSlope: 0.009,
  GorgeMinimumIncision: 12,
  // Metres a summit rises above the highest col joining it to higher ground, or the sea.
  PeakMinimumProminence: 300,
  // Mountain land: above the first height, or above the second with this much local relief.
  MountainElevation: 1000,
  HillElevation: 500,
  MountainLocalRelief: 300,
  // Metres from a cell to the terrain that measures its local relief and valley flanks.
  ReliefRadius: 15_000,
  // A river corridor whose flanks stand this many metres above it is a named valley.
  ValleyMinimumDepth: 100,
  // Metres of continuous incised river before a valley is named.
  ValleyMinimumLength: 40_000,
  // Square metres of mountain land below which a range is left unnamed.
  RangeMinimumArea: 2_000_000_000,
  CliffSlopeThreshold: 0.012,
  PlainSlopeThreshold: 0.003,
  IceTemperatureThreshold: 285,
  PermanentSeaIceTemperature: 205,
  IceMarginTemperature: 300,
  GlacierThicknessThreshold: 250,
  GlacierFluxThreshold: 120_000_000,
  IceTransportYears: 1000,
  // Extra erosive power of sliding ice at full Aurora charge, per mille.
  ChargedIceErosion: 600,
  MinimumIceBalance: 80,
  GeothermalVentThreshold: 720,
  MantlePlumeCount: 3,
  MantlePlumeRadius: 110_000,
  MantlePlumeMinimumSpacing: 360_000,
  MantlePlumeStrength: 940,
  MantlePlumeMinimumShare: 260,
  MantlePlumeStrengthExponent: 1700,
  // Hotspot track length per epoch; each epoch's cone forms at the new head.
  MantlePlumeDriftPerEpoch: 80_000,
  VolcanicConeRadius: 8_000,
  VolcanicConeHeight: 1_200,
  VolcanicApronHeight: 70,
  VolcanicCalderaChance: 180,
  VolcanicCalderaDepth: 90,
  FractureBranchCount: 24,
  FractureMinimumLength: 180_000,
  FractureMaximumLength: 1_200_000,
  FractureMinimumSpacing: 180_000,
  FractureWidth: 10_000,
  FractureConductanceFloor: 25,
  // Share of conductance above the floor that survives each later epoch.
  FractureRetentionPerEpoch: 400,
  QualityTargets: {
    OceanCoverage: { target: 0.65, minimum: 0.38, maximum: 0.66 },
    InlandLakeBodyCount: { minimum: 2, maximum: 80 },
  },
};
export type PhysicalProfile = typeof physicalProfile;
