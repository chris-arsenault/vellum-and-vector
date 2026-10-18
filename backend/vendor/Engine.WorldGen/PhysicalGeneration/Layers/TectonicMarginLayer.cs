namespace Engine.WorldGen;

using Engine.Constants;

/// <summary>
/// Classifies every triangle by what the nearest plate boundary is doing to
/// it, and ages oceanic crust away from spreading centres.
///
/// The generator already computed plate motion and boundary type and then
/// discarded both before the coast, so every coastline came out the same kind
/// of smooth passive margin. Coastal layers consume these facts so coasts
/// differ in kind: broad shallow shelves and platform peninsulas on passive
/// margins, deep inlets on rifted ones, arcs and offshore island groups on
/// convergent ones, straight faulted coasts on transforms.
/// </summary>
internal sealed class TectonicMarginLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "tectonic-margins",
        0,
        PhysicalGeographyFacts.TectonicProvinces,
        PhysicalGeographyFacts.TectonicMargins,
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.Landmasses |
        PhysicalGeographyFacts.CoastalEvolution |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        var reach = Math.Max(1, context.Profile.MarginInfluenceReach);
        var boundaryDistance = new int[map.Grid.TriangleCount];
        var boundaryKind = new int[map.Grid.TriangleCount];
        var spreadingDistance = new int[map.Grid.TriangleCount];
        PropagateFromBoundaries(map, reach, boundaryDistance, boundaryKind, spreadingDistance);
        AssignMargins(map, boundaryKind);
        if (context.IsEvolutionEpoch)
        {
            AgeTransportedCrust(map, context.Profile);
        }
        else
        {
            AssignInitialCrustAge(map, spreadingDistance, context.Profile);
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        var margins = new int[PhysicalMarginCodes.Max + 1];
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var margin = map.MarginCodes[triangleIndex];
            if (margin is < PhysicalMarginCodes.Min or > PhysicalMarginCodes.Max)
            {
                throw new InvalidOperationException("Margin classification produced an invalid code.");
            }

            if (map.CrustAge[triangleIndex] is < 0 or > 1000)
            {
                throw new InvalidOperationException("Crust age is outside its scalar range.");
            }

            margins[margin]++;
        }

        // A world whose every margin is the same kind is the defect this layer
        // exists to prevent, so require genuine variety rather than mere
        // presence.
        var kinds = 0;
        for (var margin = PhysicalMarginCodes.Passive; margin <= PhysicalMarginCodes.Max; margin++)
        {
            kinds += margins[margin] > 0 ? 1 : 0;
        }

        if (kinds < 2 && context.Profile.MarginInfluenceReach > 0)
        {
            throw new InvalidOperationException(
                "Tectonic margins collapsed to a single kind across the whole world.");
        }
    }

    /// <summary>
    /// Multi-source breadth-first expansion from boundary triangles, so each
    /// triangle learns the kind of the nearest boundary within reach. Spreading
    /// distance is tracked separately because crust age depends on distance
    /// from divergent boundaries specifically.
    /// </summary>
    private static void PropagateFromBoundaries(
        PhysicalGeographyField map,
        int reach,
        int[] boundaryDistance,
        int[] boundaryKind,
        int[] spreadingDistance)
    {
        Array.Fill(boundaryDistance, int.MaxValue);
        Array.Fill(spreadingDistance, int.MaxValue);
        var frontier = new Queue<int>();
        var spreadingFrontier = new Queue<int>();
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var code = map.TectonicBoundaryCodes[triangleIndex];
            if (code == PhysicalTectonicBoundaryCodes.None)
            {
                continue;
            }

            boundaryDistance[triangleIndex] = 0;
            boundaryKind[triangleIndex] = code;
            frontier.Enqueue(triangleIndex);
            if (code == PhysicalTectonicBoundaryCodes.Divergent)
            {
                spreadingDistance[triangleIndex] = 0;
                spreadingFrontier.Enqueue(triangleIndex);
            }
        }

        Expand(map, frontier, boundaryDistance, boundaryKind, reach);
        Expand(map, spreadingFrontier, spreadingDistance, null, int.MaxValue);
    }

    private static void Expand(
        PhysicalGeographyField map,
        Queue<int> frontier,
        int[] distance,
        int[]? kind,
        int reach)
    {
        while (frontier.TryDequeue(out var triangleIndex))
        {
            var next = distance[triangleIndex] + 1;
            if (next > reach)
            {
                continue;
            }

            for (var edge = 0; edge < 3; edge++)
            {
                var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
                if (neighbor < 0 || distance[neighbor] <= next)
                {
                    continue;
                }

                distance[neighbor] = next;
                if (kind is not null)
                {
                    kind[neighbor] = kind[triangleIndex];
                }

                frontier.Enqueue(neighbor);
            }
        }
    }

    private static void AssignMargins(PhysicalGeographyField map, int[] boundaryKind)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            map.MarginCodes[triangleIndex] = boundaryKind[triangleIndex] switch
            {
                PhysicalTectonicBoundaryCodes.Convergent => PhysicalMarginCodes.Convergent,
                PhysicalTectonicBoundaryCodes.Divergent => PhysicalMarginCodes.Rifted,
                PhysicalTectonicBoundaryCodes.Transform => PhysicalMarginCodes.Transform,

                // Crust out of reach of any active boundary is plate interior.
                // On continental crust that is a passive margin once the coast
                // finds it; oceanic interior stays abyssal plain.
                _ => map.CrustTypeCodes[triangleIndex] == PhysicalCrustTypeCodes.Continental
                    ? PhysicalMarginCodes.Passive
                    : PhysicalMarginCodes.Interior,
            };
        }
    }

    /// <summary>
    /// Ocean floor subsides as it cools away from a spreading centre, so the
    /// normalized thermal age follows roughly the square root of distance.
    /// Crustal support consumes this age to deepen ocean basins; solved-sea-
    /// level margin evolution owns continental shelves separately.
    /// </summary>
    private static void AssignInitialCrustAge(
        PhysicalGeographyField map,
        int[] spreadingDistance,
        PhysicalGeographyGenerationProfile profile)
    {
        var oldest = 0;
        for (var triangleIndex = 0; triangleIndex < spreadingDistance.Length; triangleIndex++)
        {
            if (spreadingDistance[triangleIndex] != int.MaxValue)
            {
                oldest = Math.Max(oldest, spreadingDistance[triangleIndex]);
            }
        }

        var scale = Math.Max(1, Math.Min(oldest, profile.CrustAgeSaturationDistance));
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var distance = spreadingDistance[triangleIndex];
            var normalized = distance == int.MaxValue
                ? 1d
                : Math.Clamp(distance / (double)scale, 0d, 1d);
            map.CrustAge[triangleIndex] = (int)Math.Round(
                Math.Sqrt(normalized) * 1000d,
                MidpointRounding.AwayFromZero);
        }
    }

    private static void AgeTransportedCrust(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile)
    {
        var increment = Math.Max(
            1,
            (int)Math.Round(
                map.LastPlateDriftStep * 1000d /
                    Math.Max(1d, profile.CrustAgeSaturationDistance),
                MidpointRounding.AwayFromZero));
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.AdvectionSourceIndex[triangleIndex] < 0)
            {
                map.CrustAge[triangleIndex] = 0;
            }
            else if (map.CrustContinentalFraction[triangleIndex] < 500)
            {
                map.CrustAge[triangleIndex] = Math.Min(
                    1000,
                    map.CrustAge[triangleIndex] + increment);
            }
        }
    }
}
