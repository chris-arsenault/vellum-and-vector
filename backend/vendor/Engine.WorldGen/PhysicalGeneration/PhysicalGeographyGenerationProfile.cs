namespace Engine.WorldGen;

using Engine.Constants;

public sealed record CoverageTarget
{
    public CoverageTarget(double target, double tolerance)
    {
        if (target is < 0d or > 1d)
        {
            throw new ArgumentOutOfRangeException(nameof(target));
        }

        if (tolerance is < 0d or > 1d || target - tolerance < 0d || target + tolerance > 1d)
        {
            throw new ArgumentOutOfRangeException(nameof(tolerance));
        }

        Target = target;
        Tolerance = tolerance;
    }

    public double Target { get; }

    public double Tolerance { get; }

    public double Minimum => Target - Tolerance;

    public double Maximum => Target + Tolerance;

    public bool Contains(double value) => value >= Minimum && value <= Maximum;
}

public sealed record CountTarget
{
    public CountTarget(int minimum, int maximum)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(minimum);
        ArgumentOutOfRangeException.ThrowIfLessThan(maximum, minimum);

        Minimum = minimum;
        Maximum = maximum;
    }

    public int Minimum { get; }

    public int Maximum { get; }

    public bool Contains(int value) => value >= Minimum && value <= Maximum;
}

/// <summary>
/// Generation controls consumed by causal layers to shape their own output.
/// These are not acceptance gates: geographic quality is judged from rendered
/// worlds, and fixed-proportion gates previously accepted visibly bad maps
/// while encouraging tuning of the proxy. Every target here must be read by a
/// layer — an unread target is dead configuration that reads as coverage, and
/// a dozen of them were removed for exactly that reason.
/// </summary>
public sealed record PhysicalGeographyQualityTargets
{
    /// <summary>Consumed by <see cref="OceanConnectivityLayer"/>.</summary>
    public CoverageTarget OceanCoverage { get; init; } = new(0.52d, 0.14d);

    /// <summary>Consumed by <see cref="LandIceLayer"/>.</summary>
    public CoverageTarget LandIceCoverage { get; init; } = new(0.14d, 0.10d);

    /// <summary>Consumed by <see cref="SeaIceLayer"/>.</summary>
    public CoverageTarget SeaIceCoverage { get; init; } = new(0.42d, 0.32d);

    /// <summary>Consumed by <see cref="LakeBasinLayer"/>.</summary>
    public CountTarget InlandLakeBodyCount { get; init; } = new(2, 80);

    internal void Validate()
    {
        if (OceanCoverage is null || LandIceCoverage is null || SeaIceCoverage is null ||
            InlandLakeBodyCount is null)
        {
            throw new InvalidOperationException("Physical geography quality targets cannot be null.");
        }
    }
}

/// <summary>
/// Domain-neutral configuration for the causal physical generation layers.
/// All distribution goals are configurable targets. Structural truths such as
/// acyclic flow remain invariants.
/// </summary>
public sealed record PhysicalGeographyGenerationProfile
{
    public bool ExpectNaturalDiversity { get; init; } = true;
    /// <summary>
    /// Generated border outside the requested content area, measured in
    /// microtriangle centroid steps.
    /// </summary>
    public int BoundaryPaddingSteps { get; init; } = 144;

    public int ElevationScale { get; init; } = 1000;

    public int TectonicProvinceCount { get; init; } = 14;

    public int TectonicSiteCandidateMultiplier { get; init; } = 24;

    public int ContinentalAssemblyCount { get; init; } = 4;

    public double ContinentalCrustFraction { get; init; } = 0.48d;

    public double ContinentalTransitionWidth { get; init; } = 26d;

    public double ContinentalAssemblySeparationDepth { get; init; } = 0.38d;

    public double ContinentalCrustPotentialFloor { get; init; } = 0.62d;

    public double OceanicCrustPotentialCeiling { get; init; } = 0.38d;

    public double ContinentalWarpScale { get; init; } = 54d;

    public double ContinentalWarpStrength { get; init; } = 18d;

    public double RidgeWidth { get; init; } = 11d;

    public double TectonicMotionMinimum { get; init; } = 0.22d;

    public double TectonicMotionMaximum { get; init; } = 0.72d;

    public double TectonicConvergenceThreshold { get; init; } = 0.12d;

    public int TectonicBoundaryPersistence { get; init; } = 420;

    /// <summary>
    /// Maximum microtriangle steps searched across a convergent province band
    /// for unlike transported continental material.
    /// </summary>
    public int ContinentalSutureDetectionReach { get; init; } = 6;

    /// <summary>Minimum continental fraction admitted as one side of a suture.</summary>
    public int ContinentalSutureMinimumFraction { get; init; } = 420;

    /// <summary>
    /// Per-mille approach toward full suture strength during one fully active
    /// collision epoch.
    /// </summary>
    public int ContinentalSutureStrengthGain { get; init; } = 620;

    /// <summary>
    /// World units a plate at full speed travels in the *first* epoch. Plates
    /// hold still during an epoch and move between them, so every epoch is a
    /// static snapshot of a moved arrangement rather than a moving-boundary
    /// simulation.
    ///
    /// Expressed as a per-mille share of the world's radius in world units so
    /// it means the same thing at any map size — an absolute distance would
    /// carry a small test world clean off itself.
    ///
    /// Sized against continent scale on purpose: the first step must be a
    /// large fraction of a continent, or crust never travels far enough for a
    /// continental interior to be former ocean floor.
    /// </summary>
    public int PlateDriftPerEpoch { get; init; } = 234;

    /// <summary>
    /// Per-mille factor applied to drift each successive epoch, so the world
    /// is violently mobile while assembling and settles toward the present.
    /// Kept separate from <see cref="PhysicalGeographyEpochDefinition"/>'s
    /// tectonic strength, which scales uplift and should not be distorted to
    /// obtain movement.
    /// </summary>
    public int PlateDriftDecay { get; init; } = 420;

    /// <summary>
    /// How far, in triangles, an active plate boundary imprints its kind on
    /// surrounding crust. Crust beyond every boundary's reach is plate
    /// interior, which on continental crust is a passive margin.
    /// </summary>
    public int MarginInfluenceReach { get; init; } = 26;

    /// <summary>
    /// Distance from a spreading centre, in triangles, at which oceanic crust
    /// is treated as fully aged. Beyond it, depth stops increasing.
    /// </summary>
    public int CrustAgeSaturationDistance { get; init; } = 70;

    /// <summary>
    /// Depth, per mille of the authored elevation unit, that fully aged
    /// oceanic crust subsides relative to a fresh spreading centre.
    /// </summary>
    public int OceanicSubsidenceDepth { get; init; } = 1200;

    public int PassiveShelfWidth { get; init; } = 24;

    public int RiftedShelfWidth { get; init; } = 16;

    public int TransformShelfWidth { get; init; } = 8;

    public int ContinentalSlopeWidth { get; init; } = 24;

    public int ContinentalShelfDepth { get; init; } = 150;

    public int ContinentalSlopeDepth { get; init; } = 1100;

    /// <summary>Exceptional trench depth below the local ambient seabed.</summary>
    public int ConvergentTrenchDepth { get; init; } = 900;

    /// <summary>
    /// Minimum width over which the continental rise accelerates from its
    /// nearly flat shelf grade toward the ordinary maximum margin grade.
    /// </summary>
    public int ContinentalRiseMinimumWidth { get; init; } = 24;

    public int PassiveMarginMaximumStep { get; init; } = 16;

    public int RiftedMarginMaximumStep { get; init; } = 18;

    public int TransformMarginMaximumStep { get; init; } = 32;

    public int MarginEvolutionResponsePerMille { get; init; } = 760;

    public int MarineSedimentCapacity { get; init; } = 180;

    /// <summary>
    /// Elevation band around sea level, in authored units, inside which
    /// coastal detail is displaced. Narrow enough not to disturb interiors.
    /// </summary>
    public int CoastalDetailBand { get; init; } = 90;

    /// <summary>
    /// Overall coastal-detail strength, per mille. Zero disables the layer.
    /// </summary>
    public int CoastalDetailStrength { get; init; } = 1000;

    /// <summary>
    /// Base wavelength of coastal displacement in world units. The octave
    /// stack reaches roughly a triangle from here, which is what makes narrow
    /// peninsulas and straits representable at all.
    /// </summary>
    public double CoastalDetailScale { get; init; } = 7d;

    public double CoastalDetailWarp { get; init; } = 2600d;

    public int CoastalDetailPassiveAmplitude { get; init; } = 62;

    public int CoastalDetailConvergentAmplitude { get; init; } = 88;

    public int CoastalDetailRiftedAmplitude { get; init; } = 74;

    public int CoastalDetailTransformAmplitude { get; init; } = 34;

    /// <summary>Extra coastal erosion resistance from volcanic rock.</summary>
    public int VolcanicRockResistance { get; init; } = 2600;

    /// <summary>Extra coastal erosion resistance from orogenic history.</summary>
    public int OrogenicRockResistance { get; init; } = 1500;

    /// <summary>Resistance removed by a full soft-sediment cover.</summary>
    public int SedimentRockWeakness { get; init; } = 900;

    /// <summary>Sediment thickness, in units, treated as fully soft cover.</summary>
    public int SoftSedimentDepth { get; init; } = 45;

    /// <summary>
    /// Cumulative glacial erosion, in units, that marks a submerged triangle
    /// as a drowned glacial valley rather than ordinary seabed.
    /// </summary>
    public int FjordMinimumGlacialErosion { get; init; } = 2;

    /// <summary>
    /// Number of alternating prevailing-wind belts across the world. One belt
    /// is a single global wind, which tilts every rain shadow the same way.
    /// </summary>
    public int CirculationBands { get; init; } = 5;

    /// <summary>
    /// How strongly each belt curves across its own width, per mille. Gives
    /// circulation cells curved streamlines instead of straight sheets.
    /// </summary>
    public int CirculationCellTurn { get; init; } = 700;

    /// <summary>Terrain-scale wander, per mille, so belts are not straight seams.</summary>
    public int CirculationWander { get; init; } = 550;

    public double ElevationVariationScale { get; init; } = 25d;

    public double ElevationVariationStrength { get; init; } = 0.12d;

    /// <summary>
    /// Amplitude of broad interior highlands and basins, as a fraction of
    /// <see cref="ElevationScale"/>. Applied on continental crust so interiors
    /// carry macro relief instead of saturating to one plateau height.
    /// </summary>
    public double InteriorReliefStrength { get; init; } = 0.20d;

    public double InteriorReliefScale { get; init; } = 12d;

    /// <summary>Minimum active boundary cells that form an orogenic system.</summary>
    public int OrogenicMinimumComponentSize { get; init; } = 6;

    /// <summary>Minimum boundary strain, per mille, admitted to a system.</summary>
    public int OrogenicMinimumStrain { get; init; } = 80;

    /// <summary>Maximum microtriangle steps influenced by an active system.</summary>
    public int OrogenicInfluenceReach { get; init; } = 28;

    /// <summary>
    /// Initial crustal construction budget, expressed as equilibrium-height
    /// units before the component's strain, prominence, and cross-section.
    /// </summary>
    public int InitialOrogenicConstructionStep { get; init; } = 3200;

    /// <summary>Per-epoch continuation of the same construction budget.</summary>
    public int EpochOrogenicConstructionStep { get; init; } = 1200;

    /// <summary>Half-width of broad continent-continent crustal roots.</summary>
    public double CollisionRangeWidth { get; init; } = 18d;

    /// <summary>Half-width of the continental belt above a subduction zone.</summary>
    public double SubductionRangeWidth { get; init; } = 10d;

    /// <summary>Distance from a continental rift axis to its shoulders.</summary>
    public double RiftShoulderDistance { get; init; } = 7d;

    /// <summary>Half-width of modest transform-boundary relief.</summary>
    public double TransformRangeWidth { get; init; } = 4d;

    /// <summary>Along-strike wavelength of range-scale height variation.</summary>
    public double OrogenicAlongStrikeScale { get; init; } = 42d;

    /// <summary>Weakest connected system's construction share, per mille.</summary>
    public int OrogenicProminenceMinimum { get; init; } = 700;

    /// <summary>Strongest connected system's construction share, per mille.</summary>
    public int OrogenicProminenceMaximum { get; init; } = 1900;

    /// <summary>
    /// Rank distance over which major-system prominence decays. A value above
    /// one gives several large ranges while retaining a heavy exceptional tail.
    /// </summary>
    public double OrogenicProminenceRankDecay { get; init; } = 2.4d;

    /// <summary>Maximum crustal root supported by an ordinary system.</summary>
    public int OrogenicRootBudgetMinimum { get; init; } = 1200;

    /// <summary>Maximum crustal root supported by the strongest system.</summary>
    public int OrogenicRootBudgetMaximum { get; init; } = 4000;

    /// <summary>
    /// Share of admitted root-supported uplift constructed as narrower upper-
    /// crust summit relief from the same shortening budget.
    /// </summary>
    public int OrogenicSurfaceReliefSharePerMille { get; init; } = 750;

    /// <summary>Maximum summit rock constructed at one triangle in one pass.</summary>
    public int MaximumOrogenicSurfaceReliefPerPass { get; init; } = 1400;

    /// <summary>Resistance of coherent orogenic core rock.</summary>
    public int OrogenicCoreRockResistance { get; init; } = 2200;

    /// <summary>Maximum continental crust removed beneath a mature rift axis.</summary>
    public int ContinentalRiftThinningBudget { get; init; } = 850;

    /// <summary>
    /// Water depth, in authored units, at which an ocean impact leaves no
    /// hardened rock at all. The column absorbs the shock, so the durable ring
    /// a crater is remembered by belongs to land strikes.
    /// </summary>
    public int ImpactOceanShockDepth { get; init; } = 600;

    /// <summary>
    /// Per-mille of the world's impact budget that falls in the primordial
    /// pass, the rest spread over the later epochs on a declining flux.
    /// </summary>
    public int ImpactPrimordialShare { get; init; } = 620;

    /// <summary>
    /// Wavelength at which a mantle plume's halo breaks into lobes, so it
    /// reads as sheared upwelling rather than a disc.
    /// </summary>
    public double PlumeLobeScale { get; init; } = 9d;

    /// <summary>Per-mille depth of that lobing.</summary>
    public int PlumeLobeStrength { get; init; } = 620;

    /// <summary>
    /// Per-mille depth of interior basins relative to interior highland
    /// height. Below 1000, downward macro-relief lobes are shallower than the
    /// upward ones, keeping lakes and inland seas from dominating the land.
    /// </summary>
    public int InteriorBasinDepthShare { get; init; } = 260;

    public int EpochTectonicElevationStep { get; init; } = 240;

    /// <summary>Regional response to rock added to or removed from the surface.</summary>
    public int BedrockLoadResponsePerMille { get; init; } = 280;

    /// <summary>Regional response to unconsolidated sediment load.</summary>
    public int SedimentLoadResponsePerMille { get; init; } = 360;

    /// <summary>Regional response to grounded ice load.</summary>
    public int IceLoadResponsePerMille { get; init; } = 860;

    /// <summary>Number of metric-Laplacian passes used to flex local Airy support.</summary>
    public int LithosphericFlexureIterations { get; init; } = 18;

    /// <summary>Per-pass coupling of each support column to its three neighbors.</summary>
    public int LithosphericFlexureRelaxationPerMille { get; init; } = 460;

    /// <summary>Local downslope rock-to-sediment transport above the stable slope.</summary>
    public int MassWastingIterations { get; init; } = 4;

    public int PostFluvialMassWastingIterations { get; init; } = 2;

    public int MassWastingStableStep { get; init; } = 72;

    public int MassWastingTransportFraction { get; init; } = 280;

    public int MaximumMassWastingTransportPerPass { get; init; } = 55;

    public int FluvialErosionIterations { get; init; } = 13;

    public double FluvialErosionStrength { get; init; } = 0.320d;

    /// <summary>
    /// Stable per-triangle fall retained by a unit-discharge channel. Larger
    /// rivers retain a gentler equilibrium step before further incision stops.
    /// </summary>
    public int FluvialEquilibriumStep { get; init; } = 8;

    public int SedimentTransportFraction { get; init; } = 760;

    public int SedimentDepositionSlopeThreshold { get; init; } = 34;

    public int MaximumSedimentDepositionPerPass { get; init; } = 18;

    public int ImpactCraterCount { get; init; } = 6;

    public double ImpactMinimumRadius { get; init; } = 5d;

    public double ImpactMaximumRadius { get; init; } = 18d;

    public double ImpactMinimumSpacing { get; init; } = 22d;

    public int ImpactDepthRatio { get; init; } = 280;

    public int ImpactRimHeightRatio { get; init; } = 90;

    public int ImpactEjectaFraction { get; init; } = 520;

    public int ImpactFractureStrength { get; init; } = 760;

    public double ImpactThermalRadiusThreshold { get; init; } = 12d;

    public int IceAccumulationStep { get; init; } = 420;

    public int IceAblationStep { get; init; } = 260;

    public int FrozenLakeIceAdvanceDecay { get; init; } = 40;

    public int GlacierGroundingFraction { get; init; } = 900;

    public int GlacialMeltTemperatureFloor { get; init; } = 170;

    public int GlacialAblationRunoffStrength { get; init; } = 460;

    public int BasalMeltRunoffStrength { get; init; } = 180;

    public int GlacialRetreatRunoffStrength { get; init; } = 260;

    public int MaximumGlacialErosionPerPass { get; init; } = 18;

    public int MaximumGlacialDepositionPerPass { get; init; } = 20;

    public int AncestralValleyMinimumErosion { get; init; } = 5;

    public int OutwashMinimumGlacialDeposition { get; init; } = 6;

    public int ImpactLandformMinimumExcavation { get; init; } = 18;

    public int ImpactLandformMinimumRimUplift { get; init; } = 8;

    public int InheritedRidgeActivityThreshold { get; init; } = 60;

    public int CoastalErosionWaveThreshold { get; init; } = 420;

    public int CoastalErosionStrength { get; init; } = 180;

    public int MaximumCoastalErosionPerPass { get; init; } = 12;

    public int CoastalDepositionFraction { get; init; } = 580;

    public int CoastalSeaLevelChange { get; init; }

    public double SeaLevel { get; init; }

    public int ShelfDepth { get; init; } = 210;

    public int ShelfBreakDepth { get; init; } = 430;

    public int IslandTriangleThreshold { get; init; } = 720;

    public int LakeDepthThreshold { get; init; } = 45;

    public int MinimumLakeTriangles { get; init; } = 24;

    /// <summary>
    /// Per-mille of lake members that must have two or more lake neighbors.
    /// Rejects elongated valley-chain depressions that should stay rivers.
    /// </summary>
    public int LakeCompactnessShare { get; init; } = 560;

    /// <summary>Minimum land precipitation lost to infiltration and evapotranspiration.</summary>
    public int RunoffMinimumLossPerMille { get; init; } = 160;

    /// <summary>Additional per-mille land-water loss at maximum temperature.</summary>
    public int RunoffTemperatureLossPerMille { get; init; } = 420;

    /// <summary>Minimum open-water loss in runoff units per wet triangle.</summary>
    public int LakeEvaporationMinimum { get; init; } = 180;

    /// <summary>Additional open-water loss at maximum temperature.</summary>
    public int LakeEvaporationTemperatureStrength { get; init; } = 520;

    /// <summary>Seepage loss in runoff units per wet triangle.</summary>
    public int LakeInfiltrationLoss { get; init; } = 140;

    /// <summary>Overflow at which outlet incision reaches half its maximum.</summary>
    public int LakeOutletOverflowScale { get; init; } = 120000;

    /// <summary>Maximum outlet-sill erosion during one hydrology epoch.</summary>
    public int MaximumLakeOutletIncisionPerPass { get; init; } = 140;

    /// <summary>Downstream parent steps searched for the controlling spill sill.</summary>
    public int LakeOutletIncisionSearchSteps { get; init; } = 12;

    public int DrainageGuidanceLookaheadSteps { get; init; } = 12;

    public int DrainageFloorGradientWeight { get; init; } = 1000;

    public int DrainageConditionedGradientWeight { get; init; } = 450;

    public int DrainageOutletAlignmentWeight { get; init; } = 300;

    /// <summary>
    /// Weight of the second-pass channel-capture bonus
    /// (log2 of first-pass discharge, per mille). Pulls parallel streams
    /// crossing flats into shared trunks.
    /// </summary>
    public int DrainageCaptureWeight { get; init; } = 900;

    public int DrainageInheritedValleyWeight { get; init; } = 450;

    public int RiverAccumulationThreshold { get; init; } = 10500;

    public int RiverMinimumAccumulationThreshold { get; init; } = 2400;

    public int RiverBasinHeadwaterFraction { get; init; } = 80;

    /// <summary>
    /// Discharge a basin must reach before any of it counts as a river. The
    /// basin-relative fraction keeps tributaries at every basin size, which is
    /// why it exists, but without a floor it also puts a channel in a
    /// three-triangle puddle: a fraction of a tiny maximum is a tiny
    /// threshold.
    /// </summary>
    public int RiverMinimumBasinDischarge { get; init; } = 90000;

    /// <summary>Slope at which discharge counts at face value.</summary>
    public int ChannelReferenceSlope { get; init; } = 40;

    /// <summary>Per-mille bounds on the slope weighting of discharge.</summary>
    public int ChannelSlopeFloor { get; init; } = 350;

    /// <inheritdoc cref="ChannelSlopeFloor"/>
    public int ChannelSlopeCeiling { get; init; } = 2600;

    public int MinimumRiverReachTriangles { get; init; } = 7;

    public int RiverChannelBaseStrength { get; init; } = 260;

    public int RiverChannelOrderStrength { get; init; } = 145;

    public int RiverChannelDischargeStrength { get; init; } = 55;

    public int RiverChannelWidthDecay { get; init; } = 330;

    public int RiverChannelWideningOrder { get; init; } = 2;

    public int RiverChannelWideningDischargeMultiplier { get; init; } = 5;

    public int RiverChannelMaximumExpansionSteps { get; init; } = 2;

    public int RiverChannelMaximumLongitudinalAlignment { get; init; } = 560;

    public int RiverChannelMaximumBankRelief { get; init; } = 70;

    public int FloodplainMinimumRiverOrder { get; init; } = 2;

    public int FloodplainMaximumSlope { get; init; } = 42;

    public int FloodplainMaximumRelief { get; init; } = 34;

    public int FloodplainMaximumLongitudinalAlignment { get; init; } = 720;

    public int FloodplainIntensityDecay { get; init; } = 280;

    public int FloodplainMaximumExpansionSteps { get; init; } = 2;

    public int DeltaMinimumRiverOrder { get; init; } = 2;

    public int DeltaDischargeMultiplier { get; init; } = 3;

    public int DeltaMinimumSedimentDelivery { get; init; } = 1;

    public int DeltaMaximumWaveEnergy { get; init; } = 760;

    public int DeltaMaximumCurrentStrength { get; init; } = 900;

    public int DeltaIntensityDecay { get; init; } = 240;

    public int DeltaMinimumForwardAlignment { get; init; } = 80;

    public int DeltaMaximumExpansionSteps { get; init; } = 3;

    public int TemperatureBaseline { get; init; } = 285;

    /// <summary>
    /// Cooling per unit of height above sea level. Calibrated when land topped
    /// out near 800; doubling the elevation band left the same rate freezing
    /// every highland, which starved the temperate climate surfaces and pushed
    /// most of the world into polar barrens and tundra.
    /// </summary>
    public int ElevationTemperatureLapse { get; init; } = 140;

    public int OceanModerationDistance { get; init; } = 70;

    public int OceanModerationStrength { get; init; } = 125;

    public int WarmthPocketCount { get; init; } = 15;

    public double WarmthPocketMinRadius { get; init; } = 10d;

    public double WarmthPocketMaxRadius { get; init; } = 28d;

    public int WarmthPocketMinStrength { get; init; } = 170;

    public int WarmthPocketMaxStrength { get; init; } = 390;

    public double HeartWarmthRadius { get; init; } = 28d;

    public int HeartWarmthStrength { get; init; } = 310;

    public int GeothermalTemperatureStrength { get; init; } = 310;

    public int OceanMoistureDistance { get; init; } = 90;

    public int OceanCurrentSmoothingIterations { get; init; } = 6;

    public int OceanCurrentHeatIterations { get; init; } = 10;

    public int OceanCurrentFetchSteps { get; init; } = 18;

    public int OceanCurrentMinimumStrength { get; init; } = 110;

    public int OceanCurrentTemperatureStrength { get; init; } = 150;

    public int OceanCurrentWarmthStrength { get; init; } = 120;

    public int CurrentEvaporationStrength { get; init; } = 180;

    public int PrecipitationBaseline { get; init; } = 40;

    public int OrographicPrecipitationStrength { get; init; } = 220;

    public int RainShadowStrength { get; init; } = 260;

    public int SnowTemperatureThreshold { get; init; } = 300;

    public int SnowTemperatureTransition { get; init; } = 100;

    public int SeaIceCurrentResistance { get; init; } = 220;

    public int SeaIceWaveResistance { get; init; } = 180;

    public int SeaIceSuitabilityVariation { get; init; } = 150;

    public double SeaIceVariationScale { get; init; } = 26d;

    public int RidgeElevationThreshold { get; init; } = 1000;

    public int RidgeSlopeThreshold { get; init; } = 38;

    public int PeakElevationThreshold { get; init; } = 1250;

    /// <summary>
    /// Elevation drop (units) from a channel triangle to its flow target that
    /// classifies the step as a waterfall.
    /// </summary>
    public int WaterfallMinimumDrop { get; init; } = 45;

    public int GorgeMinimumSlope { get; init; } = 90;

    public int GorgeMinimumIncision { get; init; } = 12;

    public int PeakProminenceThreshold { get; init; } = 16;

    public int CliffSlopeThreshold { get; init; } = 120;

    public int PlainSlopeThreshold { get; init; } = 30;

    public int IceTemperatureThreshold { get; init; } = 285;

    public int PermanentSeaIceTemperature { get; init; } = 205;

    public int IceMarginTemperature { get; init; } = 300;

    public int GlacierThicknessThreshold { get; init; } = 250;

    public int GlacierFluxThreshold { get; init; } = 1200;

    public int MinimumIceBalance { get; init; } = 80;

    public int GeothermalVentThreshold { get; init; } = 720;

    public int MantlePlumeCount { get; init; } = 3;

    public double MantlePlumeRadius { get; init; } = 11d;

    public double MantlePlumeMinimumSpacing { get; init; } = 36d;

    public int MantlePlumeStrength { get; init; } = 940;

    /// <summary>Weakest plume as a per-mille share of the strongest.</summary>
    public int MantlePlumeMinimumShare { get; init; } = 260;

    /// <summary>
    /// Falloff exponent across the plume rank order, per mille. Higher values
    /// concentrate strength into the first few plumes.
    /// </summary>
    public int MantlePlumeStrengthExponent { get; init; } = 1700;

    public double MantlePlumeDriftPerEpoch { get; init; } = 8d;

    public double VolcanicConeRadius { get; init; } = 4.5d;

    public int VolcanicConeHeight { get; init; } = 460;

    public int VolcanicApronHeight { get; init; } = 70;

    public int VolcanicCalderaChance { get; init; } = 180;

    public int VolcanicCalderaDepth { get; init; } = 90;

    public int FractureBranchCount { get; init; } = 24;

    public int FractureConductanceFloor { get; init; } = 25;

    public PhysicalGeographyQualityTargets QualityTargets { get; init; } = new();

    public void Validate()
    {
        if (QualityTargets is null)
        {
            throw new InvalidOperationException("Physical geography quality targets cannot be null.");
        }

        QualityTargets.Validate();
        ValidateCounts();
        ValidateScales();
        ValidateRanges();
    }

    private void ValidateCounts()
    {
        if (TectonicCountsAreInvalid() || LandscapeCountsAreInvalid())
        {
            throw new InvalidOperationException("Physical worldgen integer parameters are invalid.");
        }
    }

    private bool TectonicCountsAreInvalid() =>
        TectonicProvinceCount < 4 || TectonicSiteCandidateMultiplier < 2 ||
        MantlePlumeCount < 0 || ContinentalAssemblyCount < 2 ||
        ContinentalAssemblyCount > TectonicProvinceCount - 2 || MarginCountsAreInvalid() ||
        ContinentalSutureDetectionReach <= 0 || OrogenicCountsAreInvalid();

    private bool OrogenicCountsAreInvalid() =>
        OrogenicMinimumComponentSize <= 0 || OrogenicInfluenceReach <= 0 ||
        OrogenicMinimumStrain is <= 0 or > 1000 ||
        InitialOrogenicConstructionStep <= 0 || EpochOrogenicConstructionStep <= 0 ||
        OrogenicRootBudgetMinimum <= 0 ||
        OrogenicRootBudgetMaximum < OrogenicRootBudgetMinimum ||
        OrogenicSurfaceCountsAreInvalid() ||
        ContinentalRiftThinningBudget <= 0;

    private bool OrogenicSurfaceCountsAreInvalid() =>
        MaximumOrogenicSurfaceReliefPerPass <= 0 ||
        OrogenicCoreRockResistance < PhysicalRock.BaselineResistance;

    private bool MarginCountsAreInvalid() =>
        ShelfCountsAreInvalid() || MarginGradeCountsAreInvalid() ||
        ContinentalSlopeWidth <= 0 || ContinentalRiseMinimumWidth <= 0 ||
        ContinentalShelfDepth <= 0 || ContinentalSlopeDepth <= ContinentalShelfDepth ||
        ConvergentTrenchDepth <= 0 || MarineSedimentCapacity <= 0;

    private bool ShelfCountsAreInvalid() =>
        PassiveShelfWidth <= 0 || RiftedShelfWidth <= 0 || TransformShelfWidth <= 0;

    private bool MarginGradeCountsAreInvalid() =>
        PassiveMarginMaximumStep <= 0 || RiftedMarginMaximumStep <= 0 ||
        TransformMarginMaximumStep <= 0;

    private bool LandscapeCountsAreInvalid() =>
        BaseLandscapeCountsAreInvalid() || EvolutionCountsAreInvalid();

    private bool BaseLandscapeCountsAreInvalid() =>
        BaseElevationCountsAreInvalid() ||
        SurfaceResponseCountsAreInvalid() ||
        ImpactCraterCount < 0 ||
        HydrologyCountsAreInvalid() ||
        OceanCurrentSmoothingIterations <= 0 || OceanCurrentHeatIterations <= 0 ||
        OceanCurrentFetchSteps <= 0 || RiverGeometryCountsAreInvalid();

    private bool BaseElevationCountsAreInvalid() =>
        BoundaryPaddingSteps <= 0 || ElevationScale <= 0 ||
        FluvialErosionIterations <= 0 || FluvialEquilibriumStep <= 0;

    private bool SurfaceResponseCountsAreInvalid() =>
        LithosphericFlexureIterations <= 0 || MassWastingIterations <= 0 ||
        PostFluvialMassWastingIterations <= 0 ||
        MassWastingStableStep <= 0 || MaximumMassWastingTransportPerPass <= 0;

    private bool HydrologyCountsAreInvalid() =>
        MinimumLakeTriangles <= 0 || MinimumRiverReachTriangles <= 0 ||
        DrainageGuidanceLookaheadSteps <= 0 || LakeEvaporationMinimum < 0 ||
        LakeInfiltrationLoss < 0 || LakeOutletOverflowScale <= 0 ||
        MaximumLakeOutletIncisionPerPass <= 0 || LakeOutletIncisionSearchSteps <= 0;

    private bool RiverGeometryCountsAreInvalid() =>
        RiverChannelWideningOrder <= 0 ||
        RiverChannelWideningDischargeMultiplier <= 0 || RiverChannelMaximumExpansionSteps < 0 ||
        FloodplainMinimumRiverOrder <= 0 || FloodplainMaximumExpansionSteps < 0 ||
        DeltaMinimumRiverOrder <= 0 || DeltaDischargeMultiplier <= 0 ||
        DeltaMinimumSedimentDelivery < 0 || DeltaMaximumExpansionSteps < 0;

    private bool EvolutionCountsAreInvalid() =>
        EpochTectonicElevationStep <= 0 || IceAccumulationStep <= 0 || IceAblationStep <= 0 ||
        FrozenLakeIceAdvanceDecay <= 0 ||
        MaximumGlacialErosionPerPass <= 0 || MaximumGlacialDepositionPerPass <= 0 ||
        LandformHistoryCountsAreInvalid() || MaximumCoastalErosionPerPass <= 0 ||
        MaximumSedimentDepositionPerPass <= 0 || VolcanicCountsAreInvalid();

    private bool VolcanicCountsAreInvalid() =>
        VolcanicConeHeight <= 0 || VolcanicApronHeight <= 0 || VolcanicCalderaDepth <= 0;

    private bool LandformHistoryCountsAreInvalid() =>
        AncestralValleyMinimumErosion <= 0 || OutwashMinimumGlacialDeposition <= 0 ||
        ImpactLandformMinimumExcavation <= 0 || ImpactLandformMinimumRimUplift <= 0 ||
        InheritedRidgeActivityThreshold <= 0;

    private void ValidateScales()
    {
        if (TectonicScaleIsInvalid() || LandscapeScaleIsInvalid())
        {
            throw new InvalidOperationException("Physical worldgen feature scales are invalid.");
        }
    }

    private bool TectonicScaleIsInvalid() =>
        ContinentalTransitionWidth <= 0d || ContinentalWarpScale <= 0d ||
        RidgeWidth <= 0d || OrogenicScalesAreInvalid() ||
        ContinentalAssemblySeparationDepth <= 0d ||
        VolcanicScaleIsInvalid();

    private bool OrogenicScalesAreInvalid() =>
        CollisionRangeWidth <= 0d || SubductionRangeWidth <= 0d ||
        RiftShoulderDistance <= 0d || TransformRangeWidth <= 0d ||
        OrogenicAlongStrikeScale <= 0d || OrogenicProminenceRankDecay <= 0d;

    private bool VolcanicScaleIsInvalid() =>
        MantlePlumeRadius <= 0d || MantlePlumeMinimumSpacing <= 0d ||
        MantlePlumeDriftPerEpoch <= 0d || VolcanicConeRadius <= 0d ||
        VolcanicConeRadius >= MantlePlumeRadius;

    private bool LandscapeScaleIsInvalid() =>
        ElevationVariationScale <= 0d || FluvialErosionStrength <= 0d ||
        InteriorReliefScaleIsInvalid() ||
        ImpactMinimumRadius <= 0d || ImpactMaximumRadius < ImpactMinimumRadius ||
        ImpactMinimumSpacing <= 0d || ImpactThermalRadiusThreshold <= 0d ||
        WarmthPocketMinRadius <= 0d || HeartWarmthRadius <= 0d ||
        SeaIceVariationScale <= 0d;

    private bool CollisionRangesAreInvalid() =>
        PlumeLobeScale <= 0d || PlumeLobeStrength is < 0 or > 1000 ||
        OrogenicProminenceMinimum <= 0 ||
        OrogenicProminenceMaximum < OrogenicProminenceMinimum;

    private bool InteriorReliefScaleIsInvalid() =>
        InteriorReliefStrength < 0d || InteriorReliefScale <= 0d ||
        CollisionRangesAreInvalid() || InteriorShareIsInvalid();

    private bool InteriorShareIsInvalid() =>
        ContinentalSutureMinimumFraction is < 0 or > 1000 ||
        ContinentalSutureStrengthGain is <= 0 or > 1000 ||
        SurfaceResponseSharesAreInvalid() ||
        InteriorBasinDepthShare is <= 0 or > 1000 ||
        LakeCompactnessShare is < 0 or > 1000;

    private bool SurfaceResponseSharesAreInvalid() =>
        LoadResponseSharesAreInvalid() || SurfaceTransportSharesAreInvalid();

    private bool LoadResponseSharesAreInvalid() =>
        BedrockLoadResponsePerMille is < 0 or > 1000 ||
        SedimentLoadResponsePerMille is < 0 or > 1000 ||
        IceLoadResponsePerMille is < 0 or > 1000;

    private bool SurfaceTransportSharesAreInvalid() =>
        LithosphericFlexureRelaxationPerMille is < 0 or > 1000 ||
        OrogenicSurfaceReliefSharePerMille is < 0 or > 1000 ||
        MassWastingTransportFraction is < 0 or > 1000 ||
        MarginEvolutionResponsePerMille is < 0 or > 1000;

    private void ValidateRanges()
    {
        if (TectonicRangesAreInvalid())
        {
            throw new InvalidOperationException("Physical worldgen tectonic ranges are invalid.");
        }

        ValidateHydrologyRanges();
        ValidateClimateRanges();
    }

    private bool TectonicRangesAreInvalid() =>
        ContinentalCrustFraction is <= 0d or >= 1d ||
        ContinentalCrustPotentialFloor is <= 0d or > 1d ||
        OceanicCrustPotentialCeiling is < 0d or >= 1d ||
        OceanicCrustPotentialCeiling >= ContinentalCrustPotentialFloor ||
        TectonicMotionRangesAreInvalid();

    private bool TectonicMotionRangesAreInvalid() =>
        TectonicMotionMinimum <= 0d ||
        TectonicMotionMaximum < TectonicMotionMinimum ||
        TectonicConvergenceThreshold < 0d ||
        !IsUnitScalar(TectonicBoundaryPersistence) ||
        MantlePlumeStrength is < 1 or > 1000 || !IsUnitScalar(VolcanicCalderaChance);

    private void ValidateHydrologyRanges()
    {
        if (ShelfDepth <= 0 || ShelfBreakDepth <= ShelfDepth || RiverThresholdsAreInvalid())
        {
            throw new InvalidOperationException("Physical worldgen hydrology ranges are invalid.");
        }

        if (WaterLossRangesAreInvalid())
        {
            throw new InvalidOperationException("Surface-water loss parameters are invalid.");
        }

        if (DrainageGuidanceRangesAreInvalid())
        {
            throw new InvalidOperationException("Physical drainage-guidance weights are invalid.");
        }

        if (LandscapeEvolutionRangesAreInvalid())
        {
            throw new InvalidOperationException("Physical worldgen landscape-evolution ranges are invalid.");
        }
    }

    private bool WaterLossRangesAreInvalid() =>
        !IsUnitScalar(RunoffMinimumLossPerMille) ||
        !IsUnitScalar(RunoffTemperatureLossPerMille) ||
        RunoffMinimumLossPerMille + RunoffTemperatureLossPerMille > 1000 ||
        LakeEvaporationTemperatureStrength is < 0 or > 1000;

    private bool DrainageGuidanceRangesAreInvalid() =>
        !IsUnitScalar(DrainageFloorGradientWeight) ||
        !IsUnitScalar(DrainageConditionedGradientWeight) ||
        !IsUnitScalar(DrainageOutletAlignmentWeight) ||
        !IsUnitScalar(DrainageInheritedValleyWeight) ||
        DrainageCaptureWeight is < 0 or > 4000;

    private bool RiverThresholdsAreInvalid() =>
        RiverAccumulationThreshold <= 0 || RiverMinimumAccumulationThreshold <= 0 ||
        RiverMinimumAccumulationThreshold > RiverAccumulationThreshold ||
        RiverBasinHeadwaterFraction is < 1 or > 1000 ||
        RiverMinimumBasinDischarge < 0 || ChannelReferenceSlope <= 0 ||
        ChannelSlopeFloor <= 0 || ChannelSlopeCeiling < ChannelSlopeFloor;

    private bool LandscapeEvolutionRangesAreInvalid() =>
        !IsUnitScalar(SedimentTransportFraction) ||
        ImpactRangesAreInvalid() ||
        GlacialRunoffRangesAreInvalid() ||
        SedimentDepositionSlopeThreshold < 0 ||
        !IsUnitScalar(CoastalErosionWaveThreshold) ||
        !IsUnitScalar(CoastalErosionStrength) ||
        !IsUnitScalar(CoastalDepositionFraction) ||
        CoastalSeaLevelChange is < -1000 or > 1000 || RiverGeometryRangesAreInvalid();

    private bool ImpactRangesAreInvalid() =>
        !IsUnitScalar(ImpactDepthRatio) || !IsUnitScalar(ImpactRimHeightRatio) ||
        !IsUnitScalar(ImpactEjectaFraction) || !IsUnitScalar(ImpactFractureStrength);

    private bool GlacialRunoffRangesAreInvalid() =>
        GlacialMeltTemperatureFloor is < 0 or > 1000 ||
        !IsUnitScalar(GlacialAblationRunoffStrength) ||
        !IsUnitScalar(BasalMeltRunoffStrength) ||
        !IsUnitScalar(GlacialRetreatRunoffStrength) ||
        GlacierGroundingFraction is < 1 or > 1000;

    private bool RiverGeometryRangesAreInvalid() =>
        RiverChannelRangesAreInvalid() || FloodplainRangesAreInvalid() || DeltaRangesAreInvalid();

    private bool RiverChannelRangesAreInvalid() =>
        !IsUnitScalar(RiverChannelBaseStrength) || !IsUnitScalar(RiverChannelOrderStrength) ||
        !IsUnitScalar(RiverChannelDischargeStrength) || RiverChannelWidthDecay <= 0 ||
        !IsUnitScalar(RiverChannelMaximumLongitudinalAlignment) ||
        RiverChannelMaximumBankRelief < 0;

    private bool FloodplainRangesAreInvalid() =>
        FloodplainMaximumSlope < 0 || FloodplainMaximumRelief < 0 ||
        !IsUnitScalar(FloodplainMaximumLongitudinalAlignment) || FloodplainIntensityDecay <= 0;

    private bool DeltaRangesAreInvalid() =>
        !IsUnitScalar(DeltaMaximumWaveEnergy) ||
        !IsUnitScalar(DeltaMaximumCurrentStrength) ||
        !IsUnitScalar(DeltaMinimumForwardAlignment) || DeltaIntensityDecay <= 0;

    private static bool IsUnitScalar(int value) => value is >= 0 and <= 1000;

    private void ValidateClimateRanges()
    {
        if (BaseClimateRangesAreInvalid() || CurrentRangesAreInvalid() ||
            PrecipitationRangesAreInvalid() || SeaIceRangesAreInvalid())
        {
            throw new InvalidOperationException("Physical worldgen climate ranges are invalid.");
        }
    }

    private bool BaseClimateRangesAreInvalid() =>
        OceanModerationDistance <= 0 || OceanMoistureDistance <= 0 ||
        WarmthPocketCount < 1 || FractureBranchCount < 1 ||
        WarmthPocketMaxRadius < WarmthPocketMinRadius;

    private bool CurrentRangesAreInvalid() =>
        OceanCurrentMinimumStrength is < 0 or > 1000 ||
        OceanCurrentTemperatureStrength is < 0 or > 1000 ||
        OceanCurrentWarmthStrength is < 0 or > 1000 ||
        CurrentEvaporationStrength is < 0 or > 1000;

    private bool PrecipitationRangesAreInvalid() =>
        PrecipitationBaseline is < 0 or > 1000 ||
        OrographicPrecipitationStrength is < 0 or > 1000 ||
        RainShadowStrength is < 0 or > 1000 ||
        SnowTemperatureThreshold is < 0 or > 1000 || SnowTemperatureTransition <= 0;

    private bool SeaIceRangesAreInvalid() =>
        SeaIceCurrentResistance is < 0 or > 1000 ||
        SeaIceWaveResistance is < 0 or > 1000 ||
        SeaIceSuitabilityVariation is < 0 or > 1000;
}
