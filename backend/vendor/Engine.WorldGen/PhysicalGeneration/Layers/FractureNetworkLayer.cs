namespace Engine.WorldGen;

internal sealed class FractureNetworkLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "fracture-network",
        0x6f9d2b1,
        PhysicalGeographyFacts.TectonicProvinces |
        PhysicalGeographyFacts.ContinentalDomains |
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Impacts,
        PhysicalGeographyFacts.Fractures,
        PhysicalGeographyFacts.Geothermal | PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        if (!context.IsEvolutionEpoch)
        {
            InitializeFractureFloor(map, context.Profile.FractureConductanceFloor);
        }

        var branchCount = context.TectonicStrength == 0
            ? 0
            : Math.Max(
                1,
                context.Profile.FractureBranchCount * context.TectonicStrength / 1000);
        if (branchCount == 0)
        {
            return;
        }

        var candidateLimit = Math.Max(1024, branchCount * 256);
        var candidateSelection = new BoundedCandidateSelection(candidateLimit);
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (!map.Grid.TriangleIsInsideContentDomain(triangleIndex))
            {
                continue;
            }

            candidateSelection.Consider(
                triangleIndex,
                (map.TectonicStrain[triangleIndex] * 0.48f) +
                    (map.Uplift[triangleIndex] * 310f) +
                    (map.RidgeInfluence[triangleIndex] * 120f) +
                    (float)(PhysicalNoise.HashUnit(
                        context.Seed,
                        map.Grid.TriangleIdentity(triangleIndex),
                        0) * 90d));
        }

        var candidates = candidateSelection.GetBestIndexes();
        var networkNodes = new List<int>();
        var previousRoots = new List<int>();
        for (var branch = 0; branch < branchCount; branch++)
        {
            var root = branch > 0 && branch % 3 == 0 && networkNodes.Count > 0
                ? networkNodes[(int)(PhysicalNoise.HashUnit(context.Seed ^ 0x29f1, branch, 0) * networkNodes.Count) % networkNodes.Count]
                : SelectSeparatedRoot(map, candidates, previousRoots, branch);
            previousRoots.Add(root);
            GrowBranch(map, context, root, branch, networkNodes);
        }
    }

    private static void InitializeFractureFloor(PhysicalGeographyField map, int floor)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            map.FractureConductance[triangleIndex] = Math.Max(
                map.FractureConductance[triangleIndex],
                floor);
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        var high = 0;
        var distinctFromRidge = 0;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.FractureConductance[triangleIndex] >= 560)
            {
                high++;
                if (map.RidgeInfluence[triangleIndex] < 0.20f)
                {
                    distinctFromRidge++;
                }
            }
        }

        if (high == 0 || distinctFromRidge == 0 || high == map.Grid.TriangleCount)
        {
            throw new InvalidOperationException("Fracture generation did not create a distinct branching network.");
        }
    }

    private static int SelectSeparatedRoot(
        PhysicalGeographyField map,
        int[] candidates,
        IReadOnlyList<int> selected,
        int branch)
    {
        var minimumDistance = Math.Max(8d, map.Grid.ContentRadius / 5d);
        var minimumSquared = minimumDistance * minimumDistance;
        foreach (var candidate in candidates.Skip(branch % Math.Max(1, candidates.Length / 8)))
        {
            var x = map.Grid.TriangleX(candidate);
            var y = map.Grid.TriangleY(candidate);
            var separated = true;
            foreach (var existing in selected)
            {
                var dx = x - map.Grid.TriangleX(existing);
                var dy = y - map.Grid.TriangleY(existing);
                if ((dx * dx) + (dy * dy) < minimumSquared)
                {
                    separated = false;
                    break;
                }
            }

            if (separated)
            {
                return candidate;
            }
        }

        return candidates[branch % candidates.Length];
    }

    private static void GrowBranch(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        int root,
        int branch,
        List<int> networkNodes)
    {
        var current = root;
        var previous = -1;
        var angle = PhysicalNoise.HashUnit(context.Seed ^ 0x3da7, branch, 0) * Math.PI * 2d;
        var length = Math.Max(18, (int)Math.Round(
            map.Grid.ContentRadius * (0.8d + PhysicalNoise.HashUnit(context.Seed ^ 0x4f39, branch, 1)),
            MidpointRounding.AwayFromZero));
        for (var step = 0; step < length; step++)
        {
            map.FractureConductance[current] = Math.Max(
                map.FractureConductance[current],
                760 + (int)(PhysicalNoise.HashUnit(context.Seed, branch, step) * 240d));
            networkNodes.Add(current);
            for (var edge = 0; edge < 3; edge++)
            {
                var neighbor = map.Grid.NeighborTriangleIndex(current, edge);
                if (neighbor >= 0)
                {
                    map.FractureConductance[neighbor] = Math.Max(map.FractureConductance[neighbor], 260);
                }
            }

            var next = BestDirectedNeighbor(map, context.Seed, current, previous, angle, branch, step);
            if (next < 0)
            {
                break;
            }

            var dx = map.Grid.TriangleX(next) - map.Grid.TriangleX(current);
            var dy = map.Grid.TriangleY(next) - map.Grid.TriangleY(current);
            angle = Math.Atan2(dy, dx) + (PhysicalNoise.HashSigned(context.Seed ^ 0x5ac1, branch, step) * 0.22d);
            previous = current;
            current = next;
        }
    }

    private static int BestDirectedNeighbor(
        PhysicalGeographyField map,
        int seed,
        int current,
        int previous,
        double angle,
        int branch,
        int step)
    {
        var best = -1;
        var bestScore = double.MinValue;
        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = map.Grid.NeighborTriangleIndex(current, edge);
            if (neighbor < 0 || neighbor == previous)
            {
                continue;
            }

            var direction = Math.Atan2(
                map.Grid.TriangleY(neighbor) - map.Grid.TriangleY(current),
                map.Grid.TriangleX(neighbor) - map.Grid.TriangleX(current));
            var alignment = Math.Cos(direction - angle);
            var novelty = map.FractureConductance[neighbor] < 560 ? 0.22d : -0.08d;
            var tectonicBias = map.TectonicStrain[neighbor] / 1000d * 0.12d;
            var hash = PhysicalNoise.HashSigned(seed ^ 0x6c53, branch + step, neighbor) * 0.12d;
            var score = alignment + novelty + tectonicBias + hash;
            if (score > bestScore)
            {
                best = neighbor;
                bestScore = score;
            }
        }

        return best;
    }
}
