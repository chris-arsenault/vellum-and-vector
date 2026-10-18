namespace Engine.WorldGen;

using Engine.Constants;

internal static class ConditionedFlowResolver
{
    private const double ScoreEpsilon = 0.0000001d;

    public static int[] ResolveLandTargets(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int seed)
    {
        ArgumentNullException.ThrowIfNull(map);
        ArgumentNullException.ThrowIfNull(profile);
        var targets = new int[map.Grid.TriangleCount];
        Array.Fill(targets, -1);
        for (var triangleIndex = 0; triangleIndex < targets.Length; triangleIndex++)
        {
            if (map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.Ocean)
            {
                targets[triangleIndex] = SelectTarget(map, profile, seed, triangleIndex, null);
            }
        }

        if (profile.DrainageCaptureWeight <= 0)
        {
            return targets;
        }

        // Capture pass: with first-pass discharge known, flow prefers legal
        // candidates that already carry water. Parallel chains crossing flats
        // coalesce into shared channels instead of evenly spaced combs; the
        // conditioned-descent legality rule keeps the rerouted graph acyclic.
        var accumulation = AccumulateContributingArea(targets);
        for (var triangleIndex = 0; triangleIndex < targets.Length; triangleIndex++)
        {
            if (map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.Ocean)
            {
                targets[triangleIndex] = SelectTarget(
                    map,
                    profile,
                    seed,
                    triangleIndex,
                    accumulation);
            }
        }

        return targets;
    }

    internal static int[] AccumulateContributingArea(int[] targets)
    {
        var indegree = new int[targets.Length];
        foreach (var target in targets)
        {
            if (target >= 0)
            {
                indegree[target]++;
            }
        }

        var queue = new Queue<int>();
        for (var index = 0; index < indegree.Length; index++)
        {
            if (indegree[index] == 0)
            {
                queue.Enqueue(index);
            }
        }

        var accumulation = new int[targets.Length];
        Array.Fill(accumulation, 1);
        while (queue.TryDequeue(out var triangleIndex))
        {
            var target = targets[triangleIndex];
            if (target >= 0)
            {
                accumulation[target] = FlowGraphAlgorithms.SaturatingAdd(
                    accumulation[target],
                    accumulation[triangleIndex]);
                if (--indegree[target] == 0)
                {
                    queue.Enqueue(target);
                }
            }
        }

        return accumulation;
    }

    internal static bool IsLegalTarget(
        PhysicalGeographyField map,
        int source,
        int target)
    {
        if (target < 0 || map.Grid.EdgeLeadingTo(source, target) < 0)
        {
            return false;
        }

        return IsLegalAdjacentTarget(map, source, target);
    }

    private static bool IsLegalAdjacentTarget(
        PhysicalGeographyField map,
        int source,
        int target)
    {
        if (map.WaterKindCodes[target] == PhysicalWaterKindCodes.Ocean)
        {
            return true;
        }

        var sourceDrainage = map.DrainageElevations[source];
        var targetDrainage = map.DrainageElevations[target];
        return targetDrainage < sourceDrainage ||
            targetDrainage == sourceDrainage &&
                map.DrainageRanks[target] < map.DrainageRanks[source];
    }

    internal static int SelectByOutletAlignment(
        PhysicalGeographyField map,
        ReadOnlySpan<int> candidates,
        int source,
        int outlet,
        int seed)
    {
        if (candidates.IsEmpty)
        {
            throw new ArgumentException("Flow selection requires at least one candidate.", nameof(candidates));
        }

        DesiredDirection(map, source, outlet, out var desiredX, out var desiredY);
        var best = -1;
        var bestAlignment = double.MinValue;
        var bestTie = double.MinValue;
        foreach (var candidate in candidates)
        {
            var alignment = DirectionAlignment(map, source, candidate, desiredX, desiredY);
            var tie = CoordinateTie(map, source, candidate, seed);
            if (alignment > bestAlignment + ScoreEpsilon ||
                NearlyEqual(alignment, bestAlignment) && tie > bestTie)
            {
                best = candidate;
                bestAlignment = alignment;
                bestTie = tie;
            }
        }

        return best;
    }

    private static int SelectTarget(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int seed,
        int source,
        int[]? accumulation)
    {
        SmoothedDescentDirection(map, profile, source, out var desiredX, out var desiredY);
        var best = -1;
        var bestScore = double.MinValue;
        var bestTie = double.MinValue;
        var tieDecided = false;
        for (var edge = 0; edge < 3; edge++)
        {
            var target = map.Grid.NeighborTriangleIndex(source, edge);
            if (target < 0 || !IsLegalAdjacentTarget(map, source, target))
            {
                continue;
            }

            var alignment = (map.Grid.TriangleEdgeUnitX(source, edge) * desiredX) +
                (map.Grid.TriangleEdgeUnitY(source, edge) * desiredY);
            var score = CandidateScore(
                map,
                profile,
                source,
                target,
                alignment);
            if (accumulation is not null)
            {
                score += Math.Log2(1d + accumulation[target]) *
                    profile.DrainageCaptureWeight / 1000d;
            }
            if (score > bestScore + ScoreEpsilon)
            {
                best = target;
                bestScore = score;
                bestTie = CoordinateTie(map, source, target, seed);
                tieDecided = false;
            }
            else if (NearlyEqual(score, bestScore))
            {
                tieDecided = true;
                var tie = CoordinateTie(map, source, target, seed);
                if (tie > bestTie)
                {
                    best = target;
                    bestTie = tie;
                }
            }
        }

        map.DrainageDecisionTotal++;
        if (tieDecided)
        {
            map.DrainageTieDecisionTotal++;
        }

        return best >= 0
            ? best
            : throw new InvalidOperationException($"Conditioned triangle {source} has no outlet.");
    }

    private static double CandidateScore(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int source,
        int target,
        double alignment)
    {
        var inheritedValley = InheritedValley(map, target);
        if (map.WaterKindCodes[target] == PhysicalWaterKindCodes.Ocean)
        {
            return 10_000d + alignment;
        }

        var conditionedDrop = (map.DrainageElevations[source] - map.DrainageElevations[target]) /
            (double)PhysicalElevation.SubunitsPerUnit;
        if (conditionedDrop <= 0d)
        {
            var rankProgress = Math.Clamp(
                map.DrainageRanks[source] - map.DrainageRanks[target],
                0,
                20);
            return (alignment * profile.DrainageOutletAlignmentWeight / 10d) +
                (rankProgress * 0.15d) +
                (inheritedValley * profile.DrainageInheritedValleyWeight / 1000d);
        }

        var floorDrop = Math.Clamp(
            (map.Elevation[source] - map.Elevation[target]) /
                (double)PhysicalElevation.SubunitsPerUnit,
            -50d,
            200d);
        return (floorDrop * profile.DrainageFloorGradientWeight / 1000d) +
            (Math.Min(200d, conditionedDrop) *
                profile.DrainageConditionedGradientWeight / 1000d) +
            (alignment * profile.DrainageOutletAlignmentWeight / 20d) +
            (inheritedValley * profile.DrainageInheritedValleyWeight / 1000d);
    }

    private static double InheritedValley(PhysicalGeographyField map, int triangleIndex) =>
        Math.Clamp(
            PhysicalElevation.ToUnits(
                map.CumulativeFluvialErosion[triangleIndex] +
                map.CumulativeGlacialErosion[triangleIndex]),
            0,
            100);

    /// <summary>
    /// World-space downhill direction of the conditioned surface, estimated
    /// from edge-directional derivatives and smoothed along the flood-parent
    /// path. Unlike a steepest-edge argmax or a raw parent-chain bearing, the
    /// vector sum is not quantized to the lattice's uneven edge-direction
    /// availability, so long flow paths do not compound into an axis gutter.
    /// </summary>
    private static void SmoothedDescentDirection(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int source,
        out double desiredX,
        out double desiredY)
    {
        var sumX = 0d;
        var sumY = 0d;
        var current = source;
        for (var step = 0; step < profile.DrainageGuidanceLookaheadSteps; step++)
        {
            AddDescentGradient(map, current, ref sumX, ref sumY);
            var parent = map.DrainageParents[current];
            if (parent < 0)
            {
                break;
            }

            current = parent;
        }

        if (Math.Abs(sumX) < 0.000001d && Math.Abs(sumY) < 0.000001d)
        {
            DesiredDirection(map, source, current, out desiredX, out desiredY);
            return;
        }

        Normalize(sumX, sumY, out desiredX, out desiredY);
    }

    private static void AddDescentGradient(
        PhysicalGeographyField map,
        int triangleIndex,
        ref double sumX,
        ref double sumY)
    {
        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
            if (neighbor < 0)
            {
                continue;
            }

            var drop = (map.DrainageElevations[triangleIndex] - map.DrainageElevations[neighbor]) /
                (double)PhysicalElevation.SubunitsPerUnit;
            sumX += map.Grid.TriangleEdgeUnitX(triangleIndex, edge) * drop;
            sumY += map.Grid.TriangleEdgeUnitY(triangleIndex, edge) * drop;
        }
    }

    private static void DesiredDirection(
        PhysicalGeographyField map,
        int source,
        int target,
        out double desiredX,
        out double desiredY) =>
        Normalize(
            map.Grid.TriangleX(target) - map.Grid.TriangleX(source),
            map.Grid.TriangleY(target) - map.Grid.TriangleY(source),
            out desiredX,
            out desiredY);

    private static double DirectionAlignment(
        PhysicalGeographyField map,
        int source,
        int target,
        double desiredX,
        double desiredY)
    {
        Normalize(
            map.Grid.TriangleX(target) - map.Grid.TriangleX(source),
            map.Grid.TriangleY(target) - map.Grid.TriangleY(source),
            out var directionX,
            out var directionY);
        return (directionX * desiredX) + (directionY * desiredY);
    }

    private static double CoordinateTie(
        PhysicalGeographyField map,
        int source,
        int target,
        int seed)
    {
        var sourceX = QuantizeCoordinate(map.Grid.TriangleX(source));
        var sourceY = QuantizeCoordinate(map.Grid.TriangleY(source));
        var targetX = QuantizeCoordinate(map.Grid.TriangleX(target));
        var targetY = QuantizeCoordinate(map.Grid.TriangleY(target));
        return PhysicalNoise.HashUnit(
            seed ^ sourceX,
            sourceY ^ targetX,
            targetY);
    }

    private static int QuantizeCoordinate(float value) => checked((int)Math.Round(
        value * 4096d,
        MidpointRounding.AwayFromZero));

    private static void Normalize(double x, double y, out double normalizedX, out double normalizedY)
    {
        var length = Math.Max(0.000001d, Math.Sqrt((x * x) + (y * y)));
        normalizedX = x / length;
        normalizedY = y / length;
    }

    private static bool NearlyEqual(double first, double second) =>
        Math.Abs(first - second) < ScoreEpsilon;
}
