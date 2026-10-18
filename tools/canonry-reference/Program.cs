using System.Text.Json;
using System.Security.Cryptography;
using Engine.WorldGen;

var output = Path.GetFullPath(args[0]);
var grid = PhysicalGeographyGrid.CreateWithPadding(32, 2);
var mesh = Enumerable.Range(0, grid.TriangleCount).Select(i => new
{
    coord = grid.TriangleCoordAt(i),
    x = grid.TriangleX(i), y = grid.TriangleY(i),
    identity = grid.TriangleIdentity(i), boundary = grid.TriangleIsOnWorkBoundary(i),
    neighbors = Enumerable.Range(0, 3).Select(edge => grid.NeighborTriangleIndex(i, edge)).ToArray(),
    edgeX = Enumerable.Range(0, 3).Select(edge => grid.TriangleEdgeUnitX(i, edge)).ToArray(),
    edgeY = Enumerable.Range(0, 3).Select(edge => grid.TriangleEdgeUnitY(i, edge)).ToArray(),
}).ToArray();
var hashes = new (int Salt, int X, int Y)[]
{
    (0, 0, 0), (104729, -7, 19), (-37, int.MinValue, int.MaxValue),
    (0x6b31e7, 12, -68), (int.MinValue, int.MaxValue, int.MinValue),
}.Select(p => new { salt = p.Salt, x = p.X, y = p.Y,
    value = PhysicalNoise.HashUnit(p.Salt, p.X, p.Y) }).ToArray();
var noise = new[] { (1.25, -3.6, 7, 25d, 3), (-11.7, 27.25, 104729, 54d, 5) }
    .Select(p => new { x = p.Item1, y = p.Item2, salt = p.Item3, scale = p.Item4,
        octaves = p.Item5, value = PhysicalNoise.FractalNoise(p.Item1, p.Item2, p.Item3, p.Item4, p.Item5) })
    .ToArray();
Directory.CreateDirectory(Path.GetDirectoryName(output)!);
File.WriteAllText(output, JsonSerializer.Serialize(new
{
    source = "the-canonry-game@0f62584c114863ffadeb5e29e021f5fce6b37a61",
    mesh = new { count = grid.TriangleCount, contentRadius = grid.ContentRadius,
        workRadius = grid.WorkRadius, triangles = mesh }, hashes, noise,
    profile = new PhysicalGeographyGenerationProfile(),
    geology = Geology(),
    evolution = Evolution(),
}, new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine($"Wrote Canonry reference fixture: {output}");
if (args.Length > 1)
{
    var contracts = typeof(PhysicalGeographyEvolutionSession).Assembly.GetTypes()
        .Where(type => !type.IsAbstract && typeof(IPhysicalGeographyLayer).IsAssignableFrom(type))
        .Select(type => type == typeof(CrustalSupportLayer) || type == typeof(MassWastingLayer)
            ? (IPhysicalGeographyLayer)Activator.CreateInstance(type, new object[] { false })!
            : (IPhysicalGeographyLayer)Activator.CreateInstance(type)!)
        .Append(new MassWastingLayer(postFluvial: true))
        .Select(layer => layer.Contract).OrderBy(contract => contract.StableName)
        .ToDictionary(contract => contract.StableName, contract => new {
            salt = contract.SeedSalt,
            requires = Facts(contract.Requires), produces = Facts(contract.Produces), invalidates = Facts(contract.Invalidates),
        });
    File.WriteAllText(Path.GetFullPath(args[1]), JsonSerializer.Serialize(contracts,
        new JsonSerializerOptions { WriteIndented = true }));
}

static string[] Facts(PhysicalGeographyFacts facts) => facts == PhysicalGeographyFacts.None
    ? [] : facts.ToString().Split(", ");

static object Geology()
{
    var profile = new PhysicalGeographyGenerationProfile { BoundaryPaddingSteps = 8 };
    var map = new PhysicalGeographyField(PhysicalGeographyGrid.CreateWithPadding(2048, 8));
    var provinces = new TectonicProvinceLayer();
    provinces.Apply(map, new PhysicalGeographyGenerationContext(104729, profile, provinces.Contract));
    var domains = new ContinentalDomainLayer();
    domains.Apply(map, new PhysicalGeographyGenerationContext(104729, profile, domains.Contract));
    void Apply(IPhysicalGeographyLayer layer) => layer.Apply(map,
        new PhysicalGeographyGenerationContext(104729, profile, layer.Contract));
    Apply(new ContinentalSutureLayer());
    Apply(new TectonicMarginLayer());
    Apply(new TectonicUpliftLayer());
    Apply(new LandscapeInitializationLayer());
    Apply(new OrogenicConstructionLayer());
    Apply(new MantlePlumeRootLayer());
    Apply(new VolcanicConstructionLayer());
    Apply(new ImpactCrateringLayer());
    Apply(new MassWastingLayer());
    Apply(new CrustalSupportLayer(includeIceLoad: false));
    Apply(new LithosphericFlexureLayer());
    Apply(new OceanConnectivityLayer());
    Apply(new ContinentalMarginEvolutionLayer());
    Apply(new MarineSedimentationLayer());
    Apply(new CrustalSupportLayer(includeIceLoad: false));
    Apply(new LithosphericFlexureLayer());
    Apply(new OceanConnectivityLayer());
    Apply(new CoastalDetailLayer());
    Apply(new OceanConnectivityLayer());
    Apply(new FractureNetworkLayer());
    Apply(new GeothermalLayer());
    var initial = Fingerprint(Snapshot(map));
    Apply(new OceanConnectivityLayer()); Apply(new OceanDistanceLayer()); Apply(new BathymetryLayer());
    Apply(new LandmassLayer()); Apply(new OceanCurrentLayer()); Apply(new WarmthSourceLayer());
    Apply(new TemperatureLayer()); Apply(new AtmosphericFlowLayer()); Apply(new MoistureLayer()); Apply(new PrecipitationLayer());
    Apply(new RunoffLayer()); Apply(new DrainageConditioningLayer()); Apply(new LakeBasinLayer());
    Apply(new DrainageGuidanceLayer()); Apply(new FlowRoutingLayer()); Apply(new RiverNetworkLayer());
    var climate = Fingerprint(Snapshot(map));
    var advection = new PlateAdvectionLayer();
    advection.Apply(map, new PhysicalGeographyGenerationContext(104729, profile, advection.Contract,
        new PhysicalGeographyEpochDefinition { StableName = "reference-epoch" }, 0, 3));
    return new { initial, climate, advected = Fingerprint(Snapshot(map)) };
}

static object Fingerprint(object snapshot)
{
    var fields = new Dictionary<string, object>();
    foreach (var property in snapshot.GetType().GetProperties())
    {
        var values = ((Array)property.GetValue(snapshot)!).Cast<object>().Select(Convert.ToDouble).ToArray();
        using var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream);
        foreach (var value in values) writer.Write(value);
        fields[property.Name] = new { count = values.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(stream.ToArray())).ToLowerInvariant(),
            sample = values.Take(8).ToArray() };
    }
    return fields;
}

static object Snapshot(PhysicalGeographyField map)
{
    return new
    {
        CrustProvinceIds = map.CrustProvinceIds.ToArray(),
        CrustAssemblyIds = map.CrustAssemblyIds.ToArray(),
        CrustContinentalFraction = map.CrustContinentalFraction.ToArray(),
        CrustBasePotential = map.CrustBasePotential.ToArray(),
        CrustAssemblySeparation = map.CrustAssemblySeparation.ToArray(),
        CrustMotionX = map.CrustMotionX.ToArray(), CrustMotionY = map.CrustMotionY.ToArray(),
        TectonicBoundaryCodes = map.TectonicBoundaryCodes.ToArray(),
        TectonicBoundaryPairIds = map.TectonicBoundaryPairIds.ToArray(),
        TectonicStrain = map.TectonicStrain.ToArray(),
        TectonicTangentX = map.TectonicTangentX.ToArray(), TectonicTangentY = map.TectonicTangentY.ToArray(),
        ContinentalPotential = map.ContinentalPotential.ToArray(),
        CrustSuturePairIds = map.CrustSuturePairIds.ToArray(),
        CrustSutureStrength = map.CrustSutureStrength.ToArray(),
        CrustCollisionIntensity = map.CrustCollisionIntensity.ToArray(),
        CrustAge = map.CrustAge.ToArray(), MarginCodes = map.MarginCodes.ToArray(),
        CrustThickness = map.CrustThickness.ToArray(), Elevation = map.Elevation.ToArray(),
        BedrockElevation = map.BedrockElevation.ToArray(), SurfaceRockLoad = map.SurfaceRockLoad.ToArray(),
        SedimentThickness = map.SedimentThickness.ToArray(),
        CrustSupportTarget = map.CrustSupportTarget.ToArray(),
        CrustSupportElevation = map.CrustSupportElevation.ToArray(),
        OrogenicComponentIds = map.OrogenicComponentIds.ToArray(),
        OrogenicSystemProminence = map.OrogenicSystemProminence.ToArray(),
        OrogenicConstruction = map.OrogenicConstruction.ToArray(),
        TectonicActivityHistory = map.TectonicActivityHistory.ToArray(),
        RockResistance = map.RockResistance.ToArray(),
        MantlePlumeRootStrength = map.MantlePlumeRootStrength.ToArray(),
        VolcanicActivity = map.VolcanicActivity.ToArray(),
        VolcanicConstructionHistory = map.VolcanicConstructionHistory.ToArray(),
        VolcanicLastActiveEpoch = map.VolcanicLastActiveEpoch.ToArray(),
        ImpactExcavation = map.ImpactExcavation.ToArray(), ImpactRimUplift = map.ImpactRimUplift.ToArray(),
        ImpactEjectaThickness = map.ImpactEjectaThickness.ToArray(), ImpactHeat = map.ImpactHeat.ToArray(),
        FractureConductance = map.FractureConductance.ToArray(),
        Geothermal = map.Geothermal.ToArray(), HeatSourceDensity = map.HeatSourceDensity.ToArray(),
        WaterKindCodes = map.WaterKindCodes.ToArray(), WaterDepths = map.WaterDepths.ToArray(),
        OceanMarginDistance = map.OceanMarginDistance.ToArray(), CoastalMarginCodes = map.CoastalMarginCodes.ToArray(),
        FeatureFlags = map.FeatureFlags.ToArray(),
        OceanDistance = map.OceanDistance.ToArray(), BathymetricZoneCodes = map.BathymetricZoneCodes.ToArray(),
        LandmassIds = map.LandmassIds.ToArray(), LandmassClassCodes = map.LandmassClassCodes.ToArray(),
        ContinentalGroupIds = map.ContinentalGroupIds.ToArray(), OceanCurrentX = map.OceanCurrentX.ToArray(),
        OceanCurrentY = map.OceanCurrentY.ToArray(), OceanCurrentStrength = map.OceanCurrentStrength.ToArray(),
        OceanCurrentHeat = map.OceanCurrentHeat.ToArray(), WaveExposure = map.WaveExposure.ToArray(),
        Warmth = map.Warmth.ToArray(), Temperature = map.Temperature.ToArray(),
        WindX = map.WindX.ToArray(), WindY = map.WindY.ToArray(), UpwindTargets = map.UpwindTargets.ToArray(),
        MoistureBarriers = map.MoistureBarriers.ToArray(), PrecipitationBarriers = map.PrecipitationBarriers.ToArray(),
        UpwindOceanSources = map.UpwindOceanSources.ToArray(), Moisture = map.Moisture.ToArray(),
        Rainfall = map.Rainfall.ToArray(), Snowfall = map.Snowfall.ToArray(), Runoff = map.Runoff.ToArray(),
        DrainageElevations = map.DrainageElevations.ToArray(), DrainageRanks = map.DrainageRanks.ToArray(),
        DrainageParents = map.DrainageParents.ToArray(), WaterBodyIds = map.WaterBodyIds.ToArray(),
        LakeOutletTargets = map.LakeOutletTargets.ToArray(), LakeOverflow = map.LakeOverflow.ToArray(),
        DrainageGuidanceTargets = map.DrainageGuidanceTargets.ToArray(), FlowTargets = map.FlowTargets.ToArray(),
        FlowEdges = map.FlowEdges.ToArray(), DrainageBasinIds = map.DrainageBasinIds.ToArray(),
        FlowAccumulation = map.FlowAccumulation.ToArray(), RiverOrders = map.RiverOrders.ToArray(),
        RiverSpineEdgeMasks = map.RiverSpineEdgeMasks.ToArray(),
        CumulativeFluvialErosion = map.CumulativeFluvialErosion.ToArray(), CumulativeGlacialErosion = map.CumulativeGlacialErosion.ToArray(),
        CumulativeGlacialDeposition = map.CumulativeGlacialDeposition.ToArray(), CumulativeCoastalErosion = map.CumulativeCoastalErosion.ToArray(),
        CumulativeDeposition = map.CumulativeDeposition.ToArray(), SedimentSupply = map.SedimentSupply.ToArray(),
        IceThickness = map.IceThickness.ToArray(), IceBalance = map.IceBalance.ToArray(), IceFlux = map.IceFlux.ToArray(),
        IceFlowTargets = map.IceFlowTargets.ToArray(), GroundedIce = map.GroundedIce.ToArray(),
        MaximumIceThickness = map.MaximumIceThickness.ToArray(), MaximumIceFlux = map.MaximumIceFlux.ToArray(),
        MaximumGroundedIceFlux = map.MaximumGroundedIceFlux.ToArray(), GlacialMeltwater = map.GlacialMeltwater.ToArray(),
        LandformCodes = map.LandformCodes.ToArray(), RiverChannelStrength = map.RiverChannelStrength.ToArray(),
        RiverChannelOrders = map.RiverChannelOrders.ToArray(), FloodplainIntensity = map.FloodplainIntensity.ToArray(),
        DeltaIntensity = map.DeltaIntensity.ToArray(), SeaIceSuitability = map.SeaIceSuitability.ToArray(),
    };
}

static object Evolution()
{
    var session = PhysicalGeographyEvolutionSession.Begin(2048, 104729,
        new PhysicalGeographyGenerationProfile { BoundaryPaddingSteps = 8 });
    var stages = new Dictionary<string, object> { ["0-initial-geology"] = Fingerprint(Snapshot(session.Map)) };
    for (var epoch = 0; epoch < 2; epoch++)
    {
        session.BeginEpoch(new PhysicalGeographyEpochDefinition { StableName = $"epoch-{epoch}" }, 2);
        session.ApplyGeology();
        stages[$"{epoch}-geology"] = Fingerprint(Snapshot(session.Map));
        session.ApplyClimate(); session.ApplyHydrology();
        stages[$"{epoch}-hydrology"] = Fingerprint(Snapshot(session.Map));
        session.ApplyGlaciation(); session.ApplyPostGlacialReconciliation();
        session.MarkDomainForcingComplete(); session.ApplyCoastalEvolution(); session.CompleteEpoch();
        stages[$"{epoch}-history"] = Fingerprint(Snapshot(session.Map));
    }
    session.Complete();
    stages["present"] = Fingerprint(Snapshot(session.Map));
    return stages;
}
