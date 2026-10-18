namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class SeaIceLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "sea-ice",
        0,
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.OceanCurrents |
        PhysicalGeographyFacts.Temperature |
        PhysicalGeographyFacts.LandIce,
        PhysicalGeographyFacts.SeaIce,
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        var ocean = CollectOceanSuitability(map, context, out var suitability);

        if (ocean.Count == 0)
        {
            throw new InvalidOperationException("Sea-ice generation requires ocean.");
        }

        var targetCount = Math.Clamp(
            (int)Math.Round(
                ocean.Count * context.Profile.QualityTargets.SeaIceCoverage.Target,
                MidpointRounding.AwayFromZero),
            1,
            ocean.Count);
        var cutoff = IntegerOrderStatistics.ValueAtDescendingRank(
            System.Runtime.InteropServices.CollectionsMarshal.AsSpan(suitability),
            targetCount - 1);
        FreezeSuitableOcean(map, context.Profile, ocean, cutoff);
    }

    private static List<int> CollectOceanSuitability(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        out List<int> suitability)
    {
        var ocean = new List<int>();
        suitability = [];
        map.SeaIceSuitability.Clear();
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            map.FeatureFlags[triangleIndex] &=
                ~(PhysicalGeographyFeatureCodes.PermanentSeaIce |
                    PhysicalGeographyFeatureCodes.PermanentIceMargin);
            if (map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.Ocean ||
                !map.Grid.TriangleIsInsideContentDomain(triangleIndex))
            {
                continue;
            }

            map.IceThickness[triangleIndex] = 0;
            ocean.Add(triangleIndex);
            var value = Suitability(map, context, triangleIndex);
            map.SeaIceSuitability[triangleIndex] = value;
            suitability.Add(value);
        }

        return ocean;
    }

    private static int Suitability(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        int triangleIndex)
    {
        var coherence = (int)Math.Round(
            PhysicalNoise.FractalNoise(
                map.Grid.TriangleX(triangleIndex),
                map.Grid.TriangleY(triangleIndex),
                context.Seed,
                context.Profile.SeaIceVariationScale,
                3) * context.Profile.SeaIceSuitabilityVariation,
            MidpointRounding.AwayFromZero);
        return Math.Clamp(
            (1000 - map.Temperature[triangleIndex]) -
            (map.OceanCurrentStrength[triangleIndex] *
                context.Profile.SeaIceCurrentResistance / 1000) -
            (map.WaveExposure[triangleIndex] *
                context.Profile.SeaIceWaveResistance / 1000) -
            (map.OceanCurrentHeat[triangleIndex] / 5) + coherence,
            0,
            1000);
    }

    private static void FreezeSuitableOcean(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        IEnumerable<int> ocean,
        int cutoff)
    {
        foreach (var triangleIndex in ocean)
        {
            var coldSuitability = map.SeaIceSuitability[triangleIndex];
            if (coldSuitability < cutoff)
            {
                continue;
            }

            map.IceThickness[triangleIndex] = Math.Clamp(
                50 + ((coldSuitability - cutoff) * 2),
                50,
                240);
            map.FeatureFlags[triangleIndex] |=
                map.Temperature[triangleIndex] <= profile.PermanentSeaIceTemperature
                    ? PhysicalGeographyFeatureCodes.PermanentSeaIce
                    : PhysicalGeographyFeatureCodes.PermanentIceMargin;
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if ((map.FeatureFlags[triangleIndex] & PhysicalGeographyFeatureCodes.PermanentSeaIce) != 0 &&
                map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.Ocean)
            {
                throw new InvalidOperationException("Permanent sea ice was assigned off ocean.");
            }

            if (map.SeaIceSuitability[triangleIndex] is < 0 or > 1000 ||
                (map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.Ocean &&
                    map.SeaIceSuitability[triangleIndex] != 0))
            {
                throw new InvalidOperationException("Sea-ice suitability was assigned off ocean.");
            }
        }
    }
}
