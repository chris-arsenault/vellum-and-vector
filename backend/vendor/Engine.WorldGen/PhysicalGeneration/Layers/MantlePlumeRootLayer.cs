namespace Engine.WorldGen;

/// <summary>
/// Selects mantle-fixed plume roots once. Their surface expression may move
/// over later epochs, but the roots themselves are stable generation facts.
/// </summary>
internal sealed class MantlePlumeRootLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "mantle-plume-roots",
        0x37c1,
        PhysicalGeographyFacts.TectonicProvinces |
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.LandscapeHistory,
        PhysicalGeographyFacts.MantlePlumeRoots,
        PhysicalGeographyFacts.VolcanicConstruction |
        PhysicalGeographyFacts.Geothermal |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        map.MantlePlumeRootStrength.Clear();
        if (context.Profile.MantlePlumeCount == 0)
        {
            return;
        }

        var count = Math.Min(
            context.Profile.MantlePlumeCount,
            map.Grid.ContentTriangleCount);
        var candidateLimit = Math.Max(256, count * 256);
        var candidates = new BoundedCandidateSelection(candidateLimit);
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (!map.Grid.TriangleIsInsideContentDomain(triangleIndex))
            {
                continue;
            }

            candidates.Consider(
                triangleIndex,
                (1000 - map.TectonicStrain[triangleIndex]) +
                    (PhysicalNoise.HashUnit(
                        context.Seed,
                        map.Grid.TriangleIdentity(triangleIndex),
                        0) * 420d));
        }

        var selected = SelectSeparatedRoots(map, candidates.GetBestIndexes(), count, context.Profile);
        for (var rootIndex = 0; rootIndex < selected.Length; rootIndex++)
        {
            // Few large plumes and several small ones rather than a set of
            // near-identical ones: a handful of provinces carry a real
            // volcanic story and the rest add scattered character, instead of
            // every plume producing the same cone.
            var rank = selected.Length <= 1
                ? 0d
                : rootIndex / (double)(selected.Length - 1);
            var floor = context.Profile.MantlePlumeMinimumShare / 1000d;
            var falloff = Math.Pow(
                1d - rank,
                context.Profile.MantlePlumeStrengthExponent / 1000d);
            var variation = (floor + ((1d - floor) * falloff)) *
                (0.88d + (PhysicalNoise.HashUnit(context.Seed ^ 0x54b1, rootIndex, 0) * 0.12d));
            map.MantlePlumeRootStrength[selected[rootIndex]] = (int)Math.Round(
                context.Profile.MantlePlumeStrength * variation,
                MidpointRounding.AwayFromZero);
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        var roots = 0;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var strength = map.MantlePlumeRootStrength[triangleIndex];
            if (strength is < 0 or > 1000 ||
                (strength > 0 && !map.Grid.TriangleIsInsideContentDomain(triangleIndex)))
            {
                throw new InvalidOperationException("Mantle plume roots are invalid.");
            }

            roots += strength > 0 ? 1 : 0;
        }

        if (context.Profile.MantlePlumeCount > 0 && roots == 0)
        {
            throw new InvalidOperationException("Configured mantle plumes produced no stable roots.");
        }
    }

    private static int[] SelectSeparatedRoots(
        PhysicalGeographyField map,
        int[] candidates,
        int count,
        PhysicalGeographyGenerationProfile profile)
    {
        var spacing = Math.Min(
            profile.MantlePlumeMinimumSpacing,
            Math.Max(3d, map.Grid.ContentRadius * 1.4d));
        var minimumSquared = spacing * spacing;
        var selected = new List<int>(count);
        foreach (var candidate in candidates)
        {
            if (map.TectonicStrain[candidate] <= 420 &&
                selected.TrueForAll(root => DistanceSquared(map.Grid, root, candidate) >= minimumSquared))
            {
                selected.Add(candidate);
                if (selected.Count == count)
                {
                    return selected.ToArray();
                }
            }
        }

        foreach (var candidate in candidates)
        {
            if (!selected.Contains(candidate) &&
                selected.TrueForAll(root => DistanceSquared(map.Grid, root, candidate) >= minimumSquared))
            {
                selected.Add(candidate);
                if (selected.Count == count)
                {
                    break;
                }
            }
        }

        return selected.ToArray();
    }

    private static double DistanceSquared(PhysicalGeographyGrid grid, int first, int second)
    {
        var dx = grid.TriangleX(first) - grid.TriangleX(second);
        var dy = grid.TriangleY(first) - grid.TriangleY(second);
        return (dx * dx) + (dy * dy);
    }
}
