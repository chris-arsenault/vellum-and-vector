using Atlas.Domain;
using Engine.WorldGen;

namespace Atlas.Generation;

public static class PresentForcing
{
    public static void Apply(PhysicalGeographyField map, World world, PhysicalGeographyGenerationProfile profile,
        Func<int, Position> locate, Dictionary<Guid, double[]> history)
    {
        var rules = world.Magic.Where(rule => rule.StartsAtEpoch >= world.Epochs.Count).ToList();
        if (rules.Count == 0) return;
        var context = AtlasJson.Clone(world);
        context.Magic = rules;
        Magic.Force(map, context, locate, world.Epochs.Count, history);
        var constraints = new RootConstraints(world.Areas.Values.Single(a => a.ParentId is null));
        var pipeline = new PhysicalGeographyPipeline(profile, [], constraints.Apply);
        foreach (var layer in Layers()) pipeline.ApplyLayer(layer, map, world.Seed);
    }

    private static IEnumerable<IPhysicalGeographyLayer> Layers()
    {
        yield return new ExternalCoastalForcingLayer();
        foreach (var layer in Climate()) yield return layer;
        yield return new RunoffLayer();
        foreach (var layer in Drainage()) yield return layer;
        yield return new LandIceLayer();
        yield return new IceFlowLayer();
        yield return new GlacialMeltwaterLayer();
        yield return new RunoffLayer();
        yield return new GlacialRunoffLayer();
        foreach (var layer in Drainage()) yield return layer;
        yield return new LandIceLayer();
        yield return new IceFlowLayer();
        yield return new GlacialLandformLayer();
        yield return new SeaIceLayer();
        yield return new LandformClassificationLayer();
        yield return new RiverChannelGeometryLayer();
        yield return new FloodplainLayer();
        yield return new DeltaFormationLayer();
        yield return new PhysicalGeographyValidationLayer();
    }

    private static IEnumerable<IPhysicalGeographyLayer> Climate() => [
        new OceanConnectivityLayer(), new OceanDistanceLayer(), new BathymetryLayer(),
        new LandmassLayer(), new OceanCurrentLayer(), new WarmthSourceLayer(),
        new TemperatureLayer(), new AtmosphericFlowLayer(), new MoistureLayer(), new PrecipitationLayer()
    ];
    private static IEnumerable<IPhysicalGeographyLayer> Drainage() => [
        new DrainageConditioningLayer(), new LakeBasinLayer(),
        new DrainageGuidanceLayer(), new FlowRoutingLayer(), new RiverNetworkLayer()
    ];
}
