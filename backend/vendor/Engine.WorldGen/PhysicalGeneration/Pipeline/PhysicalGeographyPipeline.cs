namespace Engine.WorldGen;

internal sealed class PhysicalGeographyPipeline
{
    private readonly PhysicalGeographyGenerationProfile _profile;
    private readonly IReadOnlyList<IPhysicalGeographyLayer> _layers;
    private readonly Action<PhysicalGeographyField>? _constraints;

    internal PhysicalGeographyPipeline(
        PhysicalGeographyGenerationProfile profile,
        IReadOnlyList<IPhysicalGeographyLayer> layers,
        Action<PhysicalGeographyField>? constraints = null)
    {
        ArgumentNullException.ThrowIfNull(profile);
        ArgumentNullException.ThrowIfNull(layers);
        _profile = profile;
        _layers = layers;
        _constraints = constraints;
    }

    public static PhysicalGeographyPipeline CreateDefault(PhysicalGeographyGenerationProfile profile)
    {
        var ocean = new OceanConnectivityLayer();
        var oceanDistance = new OceanDistanceLayer();
        var bathymetry = new BathymetryLayer();
        var landmasses = new LandmassLayer();
        var currents = new OceanCurrentLayer();
        var warmth = new WarmthSourceLayer();
        var temperature = new TemperatureLayer();
        var atmosphericFlow = new AtmosphericFlowLayer();
        var moisture = new MoistureLayer();
        var precipitation = new PrecipitationLayer();
        var runoff = new RunoffLayer();
        var conditioning = new DrainageConditioningLayer();
        var lakes = new LakeBasinLayer();
        var guidance = new DrainageGuidanceLayer();
        var flow = new FlowRoutingLayer();
        var rivers = new RiverNetworkLayer();
        var landIce = new LandIceLayer();
        var iceFlow = new IceFlowLayer();
        var layers = CreateInitialLayers(ocean);
        AddClimateAndDrainage(
            layers, ocean, oceanDistance, bathymetry, landmasses, currents, warmth, temperature,
            atmosphericFlow, moisture, precipitation, runoff, conditioning, lakes, guidance, flow, rivers);
        AddSedimentReconciliation(layers);
        AddClimateAndDrainage(
            layers, ocean, oceanDistance, bathymetry, landmasses, currents, warmth, temperature,
            atmosphericFlow, moisture, precipitation, runoff, conditioning, lakes, guidance, flow, rivers);
        layers.Add(new CoastalErosionLayer());
        AddClimateAndDrainage(
            layers, ocean, oceanDistance, bathymetry, landmasses, currents, warmth, temperature,
            atmosphericFlow, moisture, precipitation, runoff, conditioning, lakes, guidance, flow, rivers);
        layers.Add(landIce);
        layers.Add(iceFlow);
        layers.Add(new GlacialErosionLayer());
        layers.Add(new GlacialDepositionLayer());
        layers.Add(new CrustalSupportLayer(includeIceLoad: true));
        layers.Add(new LithosphericFlexureLayer());
        AddClimateAndDrainage(
            layers, ocean, oceanDistance, bathymetry, landmasses, currents, warmth, temperature,
            atmosphericFlow, moisture, precipitation, runoff, conditioning, lakes, guidance, flow, rivers);
        AddFinalGlacialDrainage(
            layers, landIce, iceFlow, runoff, conditioning, lakes, guidance, flow, rivers);
        layers.Add(new GlacialLandformLayer());
        layers.Add(new SeaIceLayer());
        layers.Add(new LandformClassificationLayer());
        layers.Add(new RiverChannelGeometryLayer());
        layers.Add(new FloodplainLayer());
        layers.Add(new DeltaFormationLayer());
        layers.Add(new PhysicalGeographyValidationLayer());
        return new PhysicalGeographyPipeline(profile, layers);
    }

    private static void AddSedimentReconciliation(List<IPhysicalGeographyLayer> layers)
    {
        layers.Add(new SedimentTransportLayer());
        layers.Add(new MarineSedimentationLayer());
        layers.Add(new CrustalSupportLayer(includeIceLoad: false));
        layers.Add(new LithosphericFlexureLayer());
    }

    private static List<IPhysicalGeographyLayer> CreateInitialLayers(IPhysicalGeographyLayer ocean) =>
    [
        new TectonicProvinceLayer(),
        new ContinentalSutureLayer(),
        new TectonicMarginLayer(),
        new ContinentalDomainLayer(),
        new TectonicUpliftLayer(),
        new LandscapeInitializationLayer(),
        new OrogenicConstructionLayer(),
        new MantlePlumeRootLayer(),
        new VolcanicConstructionLayer(),
        new ImpactCrateringLayer(),
        new MassWastingLayer(),
        new CrustalSupportLayer(includeIceLoad: false),
        new LithosphericFlexureLayer(),
        ocean,
        new ContinentalMarginEvolutionLayer(),
        new MarineSedimentationLayer(),
        new CrustalSupportLayer(includeIceLoad: false),
        new LithosphericFlexureLayer(),
        ocean,
        new CoastalDetailLayer(),
        ocean,
        new FluvialErosionLayer(),
        new MassWastingLayer(postFluvial: true),
        new FractureNetworkLayer(),
        new GeothermalLayer(),
    ];

    private static void AddFinalGlacialDrainage(
        List<IPhysicalGeographyLayer> layers,
        IPhysicalGeographyLayer landIce,
        IPhysicalGeographyLayer iceFlow,
        IPhysicalGeographyLayer runoff,
        IPhysicalGeographyLayer conditioning,
        IPhysicalGeographyLayer lakes,
        IPhysicalGeographyLayer guidance,
        IPhysicalGeographyLayer flow,
        IPhysicalGeographyLayer rivers)
    {
        layers.Add(landIce);
        layers.Add(iceFlow);
        layers.Add(new GlacialMeltwaterLayer());
        layers.Add(runoff);
        layers.Add(new GlacialRunoffLayer());
        layers.Add(conditioning);
        layers.Add(lakes);
        layers.Add(guidance);
        layers.Add(flow);
        layers.Add(rivers);
        // Lake reconciliation invalidates the support surface used by the ice
        // state. Refresh it before final glacial classification and validation.
        layers.Add(landIce);
        layers.Add(iceFlow);
    }

    private static void AddClimateAndDrainage(
        List<IPhysicalGeographyLayer> layers,
        IPhysicalGeographyLayer ocean,
        IPhysicalGeographyLayer oceanDistance,
        IPhysicalGeographyLayer bathymetry,
        IPhysicalGeographyLayer landmasses,
        IPhysicalGeographyLayer currents,
        IPhysicalGeographyLayer warmth,
        IPhysicalGeographyLayer temperature,
        IPhysicalGeographyLayer atmosphericFlow,
        IPhysicalGeographyLayer moisture,
        IPhysicalGeographyLayer precipitation,
        IPhysicalGeographyLayer runoff,
        IPhysicalGeographyLayer conditioning,
        IPhysicalGeographyLayer lakes,
        IPhysicalGeographyLayer guidance,
        IPhysicalGeographyLayer flow,
        IPhysicalGeographyLayer rivers)
    {
        layers.Add(ocean);
        layers.Add(oceanDistance);
        layers.Add(bathymetry);
        layers.Add(landmasses);
        layers.Add(currents);
        layers.Add(warmth);
        layers.Add(temperature);
        layers.Add(atmosphericFlow);
        layers.Add(moisture);
        layers.Add(precipitation);
        layers.Add(runoff);
        layers.Add(conditioning);
        layers.Add(lakes);
        layers.Add(guidance);
        layers.Add(flow);
        layers.Add(rivers);
    }

    internal IReadOnlyList<IPhysicalGeographyLayer> Layers => _layers;

    public PhysicalGeographyField Generate(int triangleCount, int seed)
    {
        _profile.Validate();
        var map = new PhysicalGeographyField(PhysicalGeographyGrid.CreateWithPadding(
            triangleCount,
            _profile.BoundaryPaddingSteps));
        foreach (var layer in _layers)
        {
            map = ApplyLayer(layer, map, seed);
        }

        return map;
    }

    internal PhysicalGeographyField ApplyLayer(
        IPhysicalGeographyLayer layer,
        PhysicalGeographyField map,
        int rootSeed,
        PhysicalGeographyEpochDefinition? epoch = null,
        int epochIndex = -1,
        int epochCount = 0)
    {
        ArgumentNullException.ThrowIfNull(layer);
        ArgumentNullException.ThrowIfNull(map);
        _constraints?.Invoke(map);
        var missing = layer.Contract.Requires & ~map.AvailableFacts;
        if (missing != PhysicalGeographyFacts.None)
        {
            throw new InvalidOperationException(
                $"Physical generation layer '{layer.Contract.StableName}' is missing {missing}.");
        }

        var context = new PhysicalGeographyGenerationContext(
            rootSeed,
            _profile,
            layer.Contract,
            epoch,
            epochIndex,
            epochCount);
        layer.Apply(map, context);
        layer.Validate(map, context);
        map.AvailableFacts &= ~layer.Contract.Invalidates;
        map.AvailableFacts |= layer.Contract.Produces;
        return map;
    }
}
