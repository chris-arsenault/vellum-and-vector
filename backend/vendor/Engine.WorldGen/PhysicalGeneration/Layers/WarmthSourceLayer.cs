namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class WarmthSourceLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "warmth-sources",
        0x4a51c73,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.OceanDistance |
        PhysicalGeographyFacts.OceanCurrents |
        PhysicalGeographyFacts.Geothermal,
        PhysicalGeographyFacts.Warmth,
        PhysicalGeographyFacts.Temperature |
        PhysicalGeographyFacts.Moisture |
        PhysicalGeographyFacts.Precipitation |
        PhysicalGeographyFacts.Runoff |
        PhysicalGeographyFacts.LandIce |
        PhysicalGeographyFacts.SeaIce |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        map.Warmth.Clear();
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Ocean)
            {
                map.Warmth[triangleIndex] = map.OceanCurrentHeat[triangleIndex] *
                    context.Profile.OceanCurrentWarmthStrength / 1000;
            }
        }

        Paint(map, 0d, 0d, context.Profile.HeartWarmthRadius, context.Profile.HeartWarmthStrength);
        var candidates = CandidateSets(map, map.OceanDistance, context.Profile);
        var selected = new List<int>();
        for (var sourceIndex = 0; sourceIndex < context.Profile.WarmthPocketCount; sourceIndex++)
        {
            var category = sourceIndex % candidates.Length;
            var source = SelectSource(map, candidates[category], selected, context.Seed, sourceIndex);
            selected.Add(source);
            var radius = Lerp(
                context.Profile.WarmthPocketMinRadius,
                context.Profile.WarmthPocketMaxRadius,
                PhysicalNoise.HashUnit(context.Seed ^ 0x14d3, sourceIndex, 0));
            var strength = (int)Math.Round(
                Lerp(
                    context.Profile.WarmthPocketMinStrength,
                    context.Profile.WarmthPocketMaxStrength,
                    PhysicalNoise.HashUnit(context.Seed ^ 0x29f1, sourceIndex, 1)),
                MidpointRounding.AwayFromZero);
            Paint(
                map,
                map.Grid.TriangleX(source),
                map.Grid.TriangleY(source),
                radius,
                strength);
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        var warm = 0;
        var far = 0;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.Warmth[triangleIndex] > 0)
            {
                warm++;
                var x = map.Grid.TriangleX(triangleIndex);
                var y = map.Grid.TriangleY(triangleIndex);
                far += (x * x) + (y * y) >=
                    map.Grid.ContentRadius * map.Grid.ContentRadius / 4d ? 1 : 0;
            }
        }

        if (warm == 0 || far == 0)
        {
            throw new InvalidOperationException("Warmth sources did not create separated habitats.");
        }
    }

    private static List<int>[] CandidateSets(
        PhysicalGeographyField map,
        ReadOnlySpan<int> oceanDistance,
        PhysicalGeographyGenerationProfile profile)
    {
        var result = new List<int>[] { [], [], [], [] };
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (!map.Grid.TriangleIsInsideContentDomain(triangleIndex))
            {
                continue;
            }

            AddCandidate(result, map, oceanDistance, triangleIndex, profile);
        }

        return result;
    }

    private static int SelectSource(
        PhysicalGeographyField map,
        List<int> candidates,
        IReadOnlyList<int> selected,
        int seed,
        int sourceIndex)
    {
        if (candidates.Count == 0)
        {
            if (map.Grid.TryFindNearestTriangle(0d, 0d, out var center))
            {
                return center;
            }

            throw new InvalidOperationException("Physical generation contains no central triangle.");
        }

        var best = candidates[0];
        var bestScore = double.MinValue;
        var sampleCount = Math.Min(96, candidates.Count);
        for (var sample = 0; sample < sampleCount; sample++)
        {
            var candidate = candidates[(int)(PhysicalNoise.HashUnit(seed, sourceIndex, sample) * candidates.Count) % candidates.Count];
            var score = MinimumDistanceSquared(map.Grid, candidate, selected) +
                (map.Geothermal[candidate] * 0.25d) +
                (map.OceanCurrentHeat[candidate] * 0.22d) +
                PhysicalNoise.HashUnit(
                    seed ^ 0x4b67,
                    map.Grid.TriangleIdentity(candidate),
                    sample);
            if (score > bestScore)
            {
                best = candidate;
                bestScore = score;
            }
        }

        return best;
    }

    private static void AddCandidate(
        List<int>[] result,
        PhysicalGeographyField map,
        ReadOnlySpan<int> oceanDistance,
        int triangleIndex,
        PhysicalGeographyGenerationProfile profile)
    {
        var ocean = map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Ocean;
        if (ocean)
        {
            result[0].Add(triangleIndex);
            return;
        }

        if (oceanDistance[triangleIndex] is >= 1 and <= 12)
        {
            result[1].Add(triangleIndex);
        }

        if (oceanDistance[triangleIndex] >= 20 &&
            map.Elevation[triangleIndex] < PhysicalElevation.FromUnits(profile.PeakElevationThreshold))
        {
            result[2].Add(triangleIndex);
        }

        if (map.Elevation[triangleIndex] >= PhysicalElevation.FromUnits(profile.PeakElevationThreshold) &&
            map.Geothermal[triangleIndex] >= 420)
        {
            result[3].Add(triangleIndex);
        }
    }

    private static double MinimumDistanceSquared(
        PhysicalGeographyGrid grid,
        int candidate,
        IReadOnlyList<int> selected)
    {
        if (selected.Count == 0)
        {
            return 0d;
        }

        var result = double.MaxValue;
        foreach (var source in selected)
        {
            var dx = grid.TriangleX(candidate) - grid.TriangleX(source);
            var dy = grid.TriangleY(candidate) - grid.TriangleY(source);
            result = Math.Min(result, (dx * dx) + (dy * dy));
        }

        return result;
    }

    private static void Paint(
        PhysicalGeographyField map,
        double centerX,
        double centerY,
        double radius,
        int strength)
        => PhysicalRadialFieldPainter.PaintMaximum(
            map.Grid,
            map.Warmth,
            centerX,
            centerY,
            radius,
            strength);

    private static double Lerp(double first, double second, double amount) =>
        first + ((second - first) * amount);
}
