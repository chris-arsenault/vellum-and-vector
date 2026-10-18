namespace Engine.WorldGen;

using Engine.Constants;

/// <summary>
/// Reconciles the current kinematic province boundary with transported crustal
/// provenance. Unlike province-site assembly labels, a suture is material
/// history: it forms only where two unlike continental columns actually meet,
/// and then moves with those columns between epochs.
/// </summary>
internal sealed class ContinentalSutureLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "continental-sutures",
        0,
        PhysicalGeographyFacts.TectonicProvinces,
        PhysicalGeographyFacts.ContinentalSutures,
        PhysicalGeographyFacts.OrogenicConstruction |
        PhysicalGeographyFacts.CrustalSupport |
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.Landmasses |
        PhysicalGeographyFacts.Landforms |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        map.CrustCollisionIntensity.Clear();
        PreserveInheritedCoreRock(map, context.Profile);

        var visited = new int[map.Grid.TriangleCount];
        var distance = new int[map.Grid.TriangleCount];
        var queue = new int[map.Grid.TriangleCount];
        var visitId = 0;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.TectonicBoundaryCodes[triangleIndex] !=
                    PhysicalTectonicBoundaryCodes.Convergent ||
                map.TectonicStrain[triangleIndex] <= 0)
            {
                continue;
            }

            visitId++;
            var contact = FindMaterialContact(
                map,
                context.Profile,
                triangleIndex,
                visited,
                distance,
                queue,
                visitId);
            if (!contact.Exists)
            {
                continue;
            }

            RecordActiveCollision(map, context, triangleIndex, contact);
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var pair = map.CrustSuturePairIds[triangleIndex];
            var strength = map.CrustSutureStrength[triangleIndex];
            if (strength is < 0 or > 1000 || pair < 0 ||
                (strength == 0) != (pair == 0) ||
                map.CrustCollisionIntensity[triangleIndex] is < 0 or > 1000)
            {
                throw new InvalidOperationException(
                    "Continental suture generation produced invalid material history.");
            }
        }
    }

    private static void PreserveInheritedCoreRock(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var strength = map.CrustSutureStrength[triangleIndex];
            if (strength <= 0)
            {
                continue;
            }

            var inheritedResistance = PhysicalRock.BaselineResistance +
                ((profile.OrogenicCoreRockResistance - PhysicalRock.BaselineResistance) *
                    strength / 1000);
            map.RockResistance[triangleIndex] = Math.Max(
                map.RockResistance[triangleIndex],
                inheritedResistance);
        }
    }

    private static MaterialContact FindMaterialContact(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int start,
        int[] visited,
        int[] distance,
        int[] queue,
        int visitId)
    {
        var search = new MaterialSearch();
        var head = 0;
        var tail = 0;
        visited[start] = visitId;
        distance[start] = 0;
        queue[tail++] = start;

        while (head < tail)
        {
            var triangleIndex = queue[head++];
            var currentDistance = distance[triangleIndex];
            search.Observe(map, profile, triangleIndex, currentDistance);
            if (search.IsComplete)
            {
                return search.CreateContact(profile.ContinentalSutureDetectionReach);
            }

            if (currentDistance >= profile.ContinentalSutureDetectionReach)
            {
                continue;
            }

            tail = EnqueueNeighbors(
                map, triangleIndex, currentDistance, visited, distance, queue, tail, visitId);
        }

        return MaterialContact.None;
    }

    private static int EnqueueNeighbors(
        PhysicalGeographyField map,
        int triangleIndex,
        int currentDistance,
        int[] visited,
        int[] distance,
        int[] queue,
        int tail,
        int visitId)
    {
        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
            if (neighbor < 0 || visited[neighbor] == visitId)
            {
                continue;
            }

            visited[neighbor] = visitId;
            distance[neighbor] = currentDistance + 1;
            queue[tail++] = neighbor;
        }

        return tail;
    }

    private static void RecordActiveCollision(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        int triangleIndex,
        MaterialContact contact)
    {
        var strain = map.TectonicStrain[triangleIndex];
        var collision = Math.Clamp(
            (int)Math.Round(
                strain * (0.55d + (contact.Proximity * 0.45d)),
                MidpointRounding.AwayFromZero),
            0,
            1000);
        var existingPair = map.CrustSuturePairIds[triangleIndex];
        var existingStrength = map.CrustSutureStrength[triangleIndex];
        var pairMatches = existingPair == contact.PairId;
        if (existingPair == 0 || pairMatches || collision >= existingStrength)
        {
            var retained = pairMatches ? existingStrength : 0;
            var gain = (long)(1000 - retained) *
                context.Profile.ContinentalSutureStrengthGain *
                collision * context.TectonicStrength / 1_000_000_000L;
            map.CrustSuturePairIds[triangleIndex] = contact.PairId;
            map.CrustSutureStrength[triangleIndex] = Math.Clamp(
                retained + (int)Math.Max(1L, gain),
                1,
                1000);
        }

        var inherited = map.CrustSuturePairIds[triangleIndex] == contact.PairId
            ? map.CrustSutureStrength[triangleIndex] * strain / 1000
            : 0;
        map.CrustCollisionIntensity[triangleIndex] = Math.Max(collision, inherited);
    }

    private readonly record struct MaterialContact(int PairId, double Proximity)
    {
        public static MaterialContact None => new(0, 0d);

        public bool Exists => PairId != 0;

        public static MaterialContact Create(
            int firstAssembly,
            int secondAssembly,
            int contactDistance,
            int reach)
        {
            var first = Math.Min(firstAssembly, secondAssembly);
            var second = Math.Max(firstAssembly, secondAssembly);
            var proximity = 1d - (contactDistance / (double)Math.Max(1, reach + 1));
            return new MaterialContact((first << 16) | second, Math.Clamp(proximity, 0d, 1d));
        }
    }

    private sealed class MaterialSearch
    {
        private int _firstAssembly;
        private int _secondAssembly;
        private int _firstDistance = int.MaxValue;
        private int _secondDistance = int.MaxValue;

        public bool IsComplete => _firstAssembly > 0 && _secondAssembly > 0;

        public void Observe(
            PhysicalGeographyField map,
            PhysicalGeographyGenerationProfile profile,
            int triangleIndex,
            int distance)
        {
            var assembly = map.CrustAssemblyIds[triangleIndex];
            if (assembly <= 0 ||
                map.CrustContinentalFraction[triangleIndex] <
                    profile.ContinentalSutureMinimumFraction)
            {
                return;
            }

            if (_firstAssembly == 0 || assembly == _firstAssembly && distance < _firstDistance)
            {
                _firstAssembly = assembly;
                _firstDistance = Math.Min(_firstDistance, distance);
                return;
            }

            if (assembly != _firstAssembly &&
                (_secondAssembly == 0 || assembly == _secondAssembly && distance < _secondDistance))
            {
                _secondAssembly = assembly;
                _secondDistance = Math.Min(_secondDistance, distance);
            }
        }

        public MaterialContact CreateContact(int reach) => MaterialContact.Create(
            _firstAssembly,
            _secondAssembly,
            Math.Max(_firstDistance, _secondDistance),
            reach);
    }
}
