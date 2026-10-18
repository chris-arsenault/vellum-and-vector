namespace Engine.WorldGen;

/// <summary>
/// Stateful dependency-inversion boundary for multi-epoch physical evolution.
/// Domain worldgen may interleave authored forcing between the exposed phases;
/// every physical phase still executes through ordinary layer contracts.
/// </summary>
public sealed class PhysicalGeographyEvolutionSession
{
    private readonly int _rootSeed;
    private readonly PhysicalGeographyPipeline _pipeline;
    private readonly OceanConnectivityLayer _ocean = new();
    private readonly OceanDistanceLayer _oceanDistance = new();
    private readonly BathymetryLayer _bathymetry = new();
    private readonly LandmassLayer _landmasses = new();
    private readonly OceanCurrentLayer _currents = new();
    private readonly WarmthSourceLayer _warmth = new();
    private readonly TemperatureLayer _temperature = new();
    private readonly AtmosphericFlowLayer _atmosphericFlow = new();
    private readonly MoistureLayer _moisture = new();
    private readonly PrecipitationLayer _precipitation = new();
    private readonly RunoffLayer _runoff = new();
    private readonly DrainageConditioningLayer _conditioning = new();
    private readonly LakeBasinLayer _lakes = new();
    private readonly DrainageGuidanceLayer _guidance = new();
    private readonly FlowRoutingLayer _flow = new();
    private readonly RiverNetworkLayer _rivers = new();
    private readonly GlacialMeltwaterLayer _meltwater = new();
    private readonly GlacialRunoffLayer _glacialRunoff = new();
    private PhysicalGeographyEpochDefinition? _epoch;
    private EvolutionPhase _phase = EvolutionPhase.Ready;
    private int _epochCount;

    private PhysicalGeographyEvolutionSession(
        int triangleCount,
        int seed,
        PhysicalGeographyGenerationProfile profile,
        Action<PhysicalGeographyField>? constraints)
    {
        ArgumentNullException.ThrowIfNull(profile);
        profile.Validate();
        _rootSeed = seed;
        _pipeline = new PhysicalGeographyPipeline(profile, [], constraints);
        Map = new PhysicalGeographyField(PhysicalGeographyGrid.CreateWithPadding(
            triangleCount,
            profile.BoundaryPaddingSteps));
        Apply(new TectonicProvinceLayer());
        Apply(new ContinentalSutureLayer());
        Apply(new TectonicMarginLayer());
        Apply(new ContinentalDomainLayer());
        Apply(new TectonicUpliftLayer());
        Apply(new LandscapeInitializationLayer());
        Apply(new OrogenicConstructionLayer());
        Apply(new MantlePlumeRootLayer());
        Apply(new VolcanicConstructionLayer());
        Apply(new ImpactCrateringLayer());
        Apply(new MassWastingLayer());
        Apply(new CrustalSupportLayer(includeIceLoad: false));
        Apply(new LithosphericFlexureLayer());
        Apply(_ocean);
        Apply(new ContinentalMarginEvolutionLayer());
        Apply(new MarineSedimentationLayer());
        Apply(new CrustalSupportLayer(includeIceLoad: false));
        Apply(new LithosphericFlexureLayer());
        Apply(_ocean);
        Apply(new CoastalDetailLayer());
        Apply(_ocean);
        Apply(new FractureNetworkLayer());
        Apply(new GeothermalLayer());
    }

    public PhysicalGeographyField Map { get; }

    public int CompletedEpochCount => Map.CompletedEpochCount;

    public static PhysicalGeographyEvolutionSession Begin(
        int triangleCount,
        int seed,
        PhysicalGeographyGenerationProfile profile,
        Action<PhysicalGeographyField>? constraints = null) =>
        new(triangleCount, seed, profile, constraints);

    public void BeginEpoch(PhysicalGeographyEpochDefinition epoch, int totalEpochCount)
    {
        ArgumentNullException.ThrowIfNull(epoch);
        epoch.Validate();
        if (_phase != EvolutionPhase.Ready || totalEpochCount <= 0 ||
            Map.CompletedEpochCount >= totalEpochCount ||
            (_epochCount != 0 && _epochCount != totalEpochCount))
        {
            throw new InvalidOperationException("Physical evolution epoch was started out of order.");
        }

        _epoch = epoch;
        _epochCount = totalEpochCount;
        Map.ExternalHeatForcing.Clear();
        Map.ExternalCoastalForcing.Clear();
        Map.GlacialMeltwater.Clear();
        _phase = EvolutionPhase.Geology;
    }

    public void ApplyGeology()
    {
        RequirePhase(EvolutionPhase.Geology);
        // Plates move between epochs, carrying their history with them, then
        // the arrangement is re-derived at the new positions.
        Apply(new PlateAdvectionLayer());
        Apply(new TectonicProvinceLayer());
        Apply(new TectonicEpochLayer());
        Apply(new ContinentalSutureLayer());
        Apply(new TectonicMarginLayer());
        Apply(new ContinentalDomainLayer());
        Apply(new TectonicUpliftLayer());
        Apply(new OrogenicConstructionLayer());
        Apply(new VolcanicConstructionLayer());
        Apply(new ImpactCrateringLayer());
        Apply(new MassWastingLayer());
        Apply(new CrustalSupportLayer(includeIceLoad: false));
        Apply(new LithosphericFlexureLayer());
        Apply(_ocean);
        Apply(new ContinentalMarginEvolutionLayer());
        Apply(new MarineSedimentationLayer());
        Apply(new CrustalSupportLayer(includeIceLoad: false));
        Apply(new LithosphericFlexureLayer());
        Apply(_ocean);
        Apply(new FractureNetworkLayer());
        Apply(new GeothermalLayer());
        _phase = EvolutionPhase.Climate;
    }

    public void ApplyClimate()
    {
        RequirePhase(EvolutionPhase.Climate);
        ReconcileClimate();
        _phase = EvolutionPhase.Hydrology;
    }

    public void ApplyHydrology()
    {
        RequirePhase(EvolutionPhase.Hydrology);
        ApplyDrainage();
        Apply(new FluvialErosionLayer());
        Apply(new MassWastingLayer(postFluvial: true));
        // Hillslope response changes the floor that bathymetry and routing
        // describe. Sediment must follow the reconciled post-incision graph,
        // not the stale graph that authorized the river cut.
        ReconcileClimate();
        ApplyDrainage();
        Apply(new SedimentTransportLayer());
        _phase = EvolutionPhase.Glaciation;
    }

    public void ApplyGlaciation()
    {
        RequirePhase(EvolutionPhase.Glaciation);
        Apply(new LandIceLayer());
        Apply(new IceFlowLayer());
        Apply(new GlacialErosionLayer());
        Apply(new GlacialDepositionLayer());
        Apply(new CrustalSupportLayer(includeIceLoad: true));
        Apply(new LithosphericFlexureLayer());
        _phase = EvolutionPhase.PostGlacialReconciliation;
    }

    public void ApplyPostGlacialReconciliation()
    {
        RequirePhase(EvolutionPhase.PostGlacialReconciliation);
        ReconcileClimate();
        ApplyDrainage();
        Apply(new LandIceLayer());
        Apply(new IceFlowLayer());
        Apply(_meltwater);
        ApplyDrainage(includeMeltwater: true);
        _phase = EvolutionPhase.DomainForcing;
    }

    public void MarkDomainForcingComplete()
    {
        RequirePhase(EvolutionPhase.DomainForcing);
        _phase = EvolutionPhase.Coasts;
    }

    public void ApplyCoastalEvolution()
    {
        RequirePhase(EvolutionPhase.Coasts);
        Apply(new ExternalCoastalForcingLayer());
        Apply(new CoastalErosionLayer());
        _phase = EvolutionPhase.History;
    }

    public void CompleteEpoch()
    {
        RequirePhase(EvolutionPhase.History);
        Apply(new PhysicalEpochHistoryLayer());
        _epoch = null;
        _phase = EvolutionPhase.Ready;
    }

    public PhysicalGeographyField Complete()
    {
        if (_phase != EvolutionPhase.Ready || _epochCount <= 0 ||
            Map.CompletedEpochCount != _epochCount)
        {
            throw new InvalidOperationException("Physical evolution cannot finalize before every epoch completes.");
        }

        ReconcileClimate(useEpoch: false);
        ApplyDrainage(useEpoch: false);
        Apply(new LandIceLayer(), useEpoch: false);
        Apply(new IceFlowLayer(), useEpoch: false);
        Apply(_meltwater, useEpoch: false);
        ApplyDrainage(useEpoch: false, includeMeltwater: true);
        // Lake reconciliation changes the physical support surface and therefore
        // invalidates the current ice state. Refresh it before deriving glacial
        // landforms and validating grounded ice; the historical maxima remain
        // cumulative across both passes.
        Apply(new LandIceLayer(), useEpoch: false);
        Apply(new IceFlowLayer(), useEpoch: false);
        Apply(new GlacialLandformLayer(), useEpoch: false);
        Apply(new SeaIceLayer(), useEpoch: false);
        Apply(new LandformClassificationLayer(), useEpoch: false);
        Apply(new RiverChannelGeometryLayer(), useEpoch: false);
        Apply(new FloodplainLayer(), useEpoch: false);
        Apply(new DeltaFormationLayer(), useEpoch: false);
        Apply(new PhysicalGeographyValidationLayer(), useEpoch: false);
        _phase = EvolutionPhase.Complete;
        return Map;
    }

    private void ReconcileClimate(bool useEpoch = true)
    {
        Apply(_ocean, useEpoch);
        Apply(_oceanDistance, useEpoch);
        Apply(_bathymetry, useEpoch);
        Apply(_landmasses, useEpoch);
        Apply(_currents, useEpoch);
        Apply(_warmth, useEpoch);
        Apply(_temperature, useEpoch);
        Apply(_atmosphericFlow, useEpoch);
        Apply(_moisture, useEpoch);
        Apply(_precipitation, useEpoch);
    }

    private void ApplyDrainage(bool useEpoch = true, bool includeMeltwater = false)
    {
        Apply(_runoff, useEpoch);
        if (includeMeltwater)
        {
            Apply(_glacialRunoff, useEpoch);
        }

        Apply(_conditioning, useEpoch);
        Apply(_lakes, useEpoch);
        Apply(_guidance, useEpoch);
        Apply(_flow, useEpoch);
        Apply(_rivers, useEpoch);
    }

    private void Apply(IPhysicalGeographyLayer layer, bool useEpoch = true) =>
        _pipeline.ApplyLayer(
            layer,
            Map,
            _rootSeed,
            useEpoch ? _epoch : null,
            useEpoch ? Map.CompletedEpochCount : -1,
            useEpoch ? _epochCount : 0);

    private void RequirePhase(EvolutionPhase expected)
    {
        if (_phase != expected)
        {
            throw new InvalidOperationException(
                $"Physical evolution expected phase {expected}, not {_phase}.");
        }
    }

    private enum EvolutionPhase
    {
        Ready,
        Geology,
        Climate,
        Hydrology,
        Glaciation,
        PostGlacialReconciliation,
        DomainForcing,
        Coasts,
        History,
        Complete,
    }
}
