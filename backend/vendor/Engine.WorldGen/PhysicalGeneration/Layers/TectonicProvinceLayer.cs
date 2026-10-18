namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class TectonicProvinceLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "tectonic-provinces",
        0x6b31e7,
        PhysicalGeographyFacts.None,
        PhysicalGeographyFacts.TectonicProvinces,
        PhysicalGeographyFacts.ContinentalSutures |
        PhysicalGeographyFacts.OrogenicConstruction |
        PhysicalGeographyFacts.ContinentalDomains |
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Fractures |
        PhysicalGeographyFacts.Geothermal |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        var sites = CreateSites(map.Grid, context, map.AccumulatedPlateDrift);
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            AssignTriangle(map, context, sites, triangleIndex);
        }

        map.TectonicBoundaryCodes.CopyTo(map.InitialTectonicBoundaryCodes);
        map.TectonicStrain.CopyTo(map.InitialTectonicStrain);
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        var measurements = new ProvinceMeasurements();
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            ValidatePrimitive(map, triangleIndex);
            measurements.Add(map, triangleIndex, context.EpochIndex);
        }

        if (!measurements.IsComplete)
        {
            throw new InvalidOperationException("Tectonic provinces lack distinct crust and active boundaries.");
        }
    }

    private static void ValidatePrimitive(PhysicalGeographyField map, int triangleIndex)
    {
        if (IdentityIsInvalid(map, triangleIndex) ||
            ScalarIsInvalid(map, triangleIndex) ||
            MotionIsInvalid(map, triangleIndex))
        {
            throw new InvalidOperationException("Tectonic province generation produced an invalid primitive.");
        }
    }

    private static bool IdentityIsInvalid(PhysicalGeographyField map, int triangleIndex) =>
        map.CrustProvinceIds[triangleIndex] <= 0 ||
        map.CrustTypeCodes[triangleIndex] is < PhysicalCrustTypeCodes.Min or > PhysicalCrustTypeCodes.Max ||
        map.TectonicBoundaryCodes[triangleIndex] is < PhysicalTectonicBoundaryCodes.Min or
            > PhysicalTectonicBoundaryCodes.Max;

    private static bool ScalarIsInvalid(PhysicalGeographyField map, int triangleIndex) =>
        map.CrustBasePotential[triangleIndex] is < 0 or > 1000 ||
        map.CrustContinentalFraction[triangleIndex] is < 0 or > 1000 ||
        map.CrustAssemblySeparation[triangleIndex] is < 0 or > 1000 ||
        map.TectonicStrain[triangleIndex] is < 0 or > 1000 ||
        map.TectonicBoundaryPairIds[triangleIndex] < 0 ||
        (map.TectonicBoundaryCodes[triangleIndex] == PhysicalTectonicBoundaryCodes.None) !=
            (map.TectonicBoundaryPairIds[triangleIndex] == 0);

    private static bool MotionIsInvalid(PhysicalGeographyField map, int triangleIndex) =>
        map.CrustMotionX[triangleIndex] is < -1000 or > 1000 ||
        map.CrustMotionY[triangleIndex] is < -1000 or > 1000 ||
        map.TectonicTangentX[triangleIndex] is < -1000 or > 1000 ||
        map.TectonicTangentY[triangleIndex] is < -1000 or > 1000;

    /// <summary>
    /// Sites are seeded once and then translated by accumulated drift, so each
    /// epoch re-derives crust type, boundaries, and strain for a plate
    /// arrangement that has moved. The epoch-stable seed keeps the same plates
    /// across epochs — using the per-epoch seed would reshuffle them instead of
    /// moving them.
    /// </summary>
    private static ProvinceSite[] CreateSites(
        PhysicalGeographyGrid grid,
        PhysicalGeographyGenerationContext context,
        double accumulatedDrift)
    {
        var candidateCount = checked(
            context.Profile.TectonicProvinceCount * context.Profile.TectonicSiteCandidateMultiplier);
        var candidates = new SiteCandidate[candidateCount];
        var placementRadius = grid.WorkRadius * 0.94d;
        for (var index = 0; index < candidates.Length; index++)
        {
            var angle = PhysicalNoise.HashUnit(context.EpochStableSeed ^ 0x1b73, index, 0) * Math.PI * 2d;
            var radius = Math.Sqrt(PhysicalNoise.HashUnit(context.EpochStableSeed ^ 0x2db9, index, 1)) *
                placementRadius;
            candidates[index] = new SiteCandidate(
                Math.Cos(angle) * radius,
                Math.Sin(angle) * radius,
                PhysicalNoise.HashUnit(context.EpochStableSeed ^ 0x4a91, index, 2));
        }

        var selected = SelectSeparatedCandidates(candidates, context.Profile.TectonicProvinceCount);
        var assemblies = AssignContinentalAssemblies(
            selected,
            context.Profile,
            context.EpochStableSeed,
            grid.ContentRadius * 0.94d);
        var sites = new ProvinceSite[selected.Length];
        for (var index = 0; index < sites.Length; index++)
        {
            var angle = PhysicalNoise.HashUnit(context.EpochStableSeed ^ 0x5c27, index, 0) * Math.PI * 2d;
            var speed = Lerp(
                context.Profile.TectonicMotionMinimum,
                context.Profile.TectonicMotionMaximum,
                PhysicalNoise.HashUnit(context.EpochStableSeed ^ 0x73a1, index, 1));
            var motionX = Math.Cos(angle) * speed;
            var motionY = Math.Sin(angle) * speed;
            sites[index] = new ProvinceSite(
                selected[index].X + (motionX * accumulatedDrift),
                selected[index].Y + (motionY * accumulatedDrift),
                assemblies[index],
                motionX,
                motionY);
        }

        return sites;
    }

    private static SiteCandidate[] SelectSeparatedCandidates(
        SiteCandidate[] candidates,
        int count)
    {
        var selected = new SiteCandidate[count];
        selected[0] = candidates.MaxBy(static candidate => candidate.Priority);
        for (var selectedIndex = 1; selectedIndex < selected.Length; selectedIndex++)
        {
            var best = candidates[0];
            var bestScore = double.MinValue;
            foreach (var candidate in candidates)
            {
                var minimumDistance = double.MaxValue;
                for (var existingIndex = 0; existingIndex < selectedIndex; existingIndex++)
                {
                    minimumDistance = Math.Min(
                        minimumDistance,
                        DistanceSquared(candidate, selected[existingIndex]));
                }

                var score = minimumDistance * (0.88d + (candidate.Priority * 0.24d));
                if (score > bestScore)
                {
                    best = candidate;
                    bestScore = score;
                }
            }

            selected[selectedIndex] = best;
        }

        return selected;
    }

    private static int[] AssignContinentalAssemblies(
        SiteCandidate[] sites,
        PhysicalGeographyGenerationProfile profile,
        int seed,
        double configuredPlacementRadius)
    {
        var count = Math.Clamp(
            (int)Math.Round(
                sites.Length * profile.ContinentalCrustFraction,
                MidpointRounding.AwayFromZero),
            2,
            sites.Length - 2);
        var result = new int[sites.Length];
        var anchors = SelectAssemblyAnchors(
            sites,
            profile.ContinentalAssemblyCount,
            configuredPlacementRadius);
        for (var anchorIndex = 0; anchorIndex < anchors.Length; anchorIndex++)
        {
            result[anchors[anchorIndex]] = anchorIndex + 1;
        }

        var directions = AssemblyDirections(anchors.Length, seed);
        var selectedCount = anchors.Length;
        var round = 0;
        while (selectedCount < count)
        {
            var start = (int)(unchecked((uint)(seed + (round * 397))) % (uint)anchors.Length);
            for (var offset = 0; offset < anchors.Length && selectedCount < count; offset++)
            {
                var anchorIndex = (start + offset) % anchors.Length;
                var neighbor = SelectAssemblyFrontierSite(
                    sites,
                    result,
                    anchorIndex + 1,
                    anchors[anchorIndex],
                    directions[anchorIndex]);
                if (neighbor >= 0)
                {
                    result[neighbor] = anchorIndex + 1;
                    selectedCount++;
                }
            }

            round++;
        }

        return result;
    }

    private static int[] SelectAssemblyAnchors(
        SiteCandidate[] sites,
        int count,
        double configuredPlacementRadius)
    {
        var maximumDistanceSquared = configuredPlacementRadius * configuredPlacementRadius;
        var candidates = Enumerable.Range(0, sites.Length)
            .Where(index => DistanceSquaredFromOrigin(sites[index]) <= maximumDistanceSquared)
            .ToArray();
        if (candidates.Length < count)
        {
            candidates = Enumerable.Range(0, sites.Length).ToArray();
        }

        var anchors = new int[count];
        anchors[0] = candidates
            .MinBy(index => DistanceSquaredFromOrigin(sites[index]) /
                (0.80d + (sites[index].Priority * 0.40d)));
        for (var anchorIndex = 1; anchorIndex < anchors.Length; anchorIndex++)
        {
            anchors[anchorIndex] = candidates
                .Where(candidate => !anchors.Take(anchorIndex).Contains(candidate))
                .MaxBy(candidate => MinimumDistanceSquared(sites, candidate, anchors, anchorIndex));
        }

        return anchors;
    }

    private static int SelectAssemblyFrontierSite(
        SiteCandidate[] sites,
        int[] selected,
        int assemblyId,
        int anchor,
        AssemblyDirection direction)
    {
        var best = -1;
        var bestCost = double.MaxValue;
        for (var candidate = 0; candidate < sites.Length; candidate++)
        {
            if (selected[candidate] != 0)
            {
                continue;
            }

            var frontierDistance = MinimumAssemblyDistanceSquared(
                sites,
                selected,
                candidate,
                assemblyId);
            var competingDistance = MinimumCompetingDistanceSquared(
                sites,
                selected,
                candidate,
                assemblyId);
            if (competingDistance < frontierDistance * 0.62d)
            {
                continue;
            }

            var dx = sites[candidate].X - sites[anchor].X;
            var dy = sites[candidate].Y - sites[anchor].Y;
            var length = Math.Max(0.001d, Math.Sqrt((dx * dx) + (dy * dy)));
            var alignment = Math.Abs(
                ((dx / length) * direction.X) + ((dy / length) * direction.Y));
            var distance = Math.Sqrt(frontierDistance);
            var cost = distance * (1.12d - (alignment * 0.48d)) -
                (sites[candidate].Priority * distance * 0.10d);
            if (cost < bestCost)
            {
                best = candidate;
                bestCost = cost;
            }
        }

        return best >= 0
            ? best
            : Enumerable.Range(0, sites.Length)
                .Where(index => selected[index] == 0)
                .MinBy(index => MinimumAssemblyDistanceSquared(
                    sites,
                    selected,
                    index,
                    assemblyId));
    }

    private static double MinimumAssemblyDistanceSquared(
        SiteCandidate[] sites,
        int[] selected,
        int candidate,
        int assemblyId)
    {
        var minimum = double.MaxValue;
        for (var index = 0; index < sites.Length; index++)
        {
            if (selected[index] == assemblyId)
            {
                minimum = Math.Min(minimum, DistanceSquared(sites[candidate], sites[index]));
            }
        }

        return minimum;
    }

    private static double MinimumCompetingDistanceSquared(
        SiteCandidate[] sites,
        int[] selected,
        int candidate,
        int assemblyId)
    {
        var minimum = double.MaxValue;
        for (var index = 0; index < sites.Length; index++)
        {
            if (selected[index] != 0 && selected[index] != assemblyId)
            {
                minimum = Math.Min(minimum, DistanceSquared(sites[candidate], sites[index]));
            }
        }

        return minimum;
    }

    private static AssemblyDirection[] AssemblyDirections(int count, int seed)
    {
        var result = new AssemblyDirection[count];
        for (var index = 0; index < result.Length; index++)
        {
            var angle = PhysicalNoise.HashUnit(seed ^ 0x67d3, index, 0) * Math.PI * 2d;
            result[index] = new AssemblyDirection(Math.Cos(angle), Math.Sin(angle));
        }

        return result;
    }

    private static double MinimumDistanceSquared(
        SiteCandidate[] sites,
        int candidate,
        int[] anchors,
        int count)
    {
        var minimum = double.MaxValue;
        for (var index = 0; index < count; index++)
        {
            minimum = Math.Min(minimum, DistanceSquared(sites[candidate], sites[anchors[index]]));
        }

        return minimum;
    }

    private static double DistanceSquaredFromOrigin(SiteCandidate site) =>
        (site.X * site.X) + (site.Y * site.Y);

    private static void AssignTriangle(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        ReadOnlySpan<ProvinceSite> sites,
        int triangleIndex)
    {
        var sample = WarpedSample(map, context, triangleIndex);
        var selection = SelectSites(sites, sample.X, sample.Y);
        var site = sites[selection.Nearest];
        map.CrustProvinceIds[triangleIndex] = selection.Nearest + 1;
        map.CrustMotionX[triangleIndex] = ScaleMotion(site.MotionX);
        map.CrustMotionY[triangleIndex] = ScaleMotion(site.MotionY);
        var affinity = Math.Clamp(
            0.5d +
                ((selection.OceanicDistance - selection.ContinentalDistance) /
                    (context.Profile.ContinentalTransitionWidth * 2d)),
            0d,
            1d);
        var composition = affinity;
        var potential = site.Continental
            ? Math.Max(affinity, context.Profile.ContinentalCrustPotentialFloor)
            : Math.Min(affinity, context.Profile.OceanicCrustPotentialCeiling);
        var separation = AssemblyGap(context, sites, selection);
        composition = Math.Clamp(composition - separation, 0d, 1d);
        potential -= separation;
        if (site.Continental && separation > 0d)
        {
            potential = Math.Min(
                potential,
                context.Profile.ContinentalCrustPotentialFloor - separation);
        }

        var riftedMargin = site.Continental &&
            separation >= context.Profile.ContinentalAssemblySeparationDepth * 0.12d;
        AssignInitialAssembly(map, context, sites, selection, site, triangleIndex, composition, riftedMargin);
        if (riftedMargin)
        {
            potential = Math.Min(
                potential,
                context.Profile.OceanicCrustPotentialCeiling - separation);
            composition = Math.Min(
                composition,
                context.Profile.OceanicCrustPotentialCeiling - separation);
        }

        map.CrustAssemblySeparation[triangleIndex] = ScaleUnit(separation);
        map.CrustBasePotential[triangleIndex] = ScaleUnit(potential);
        if (!context.IsEvolutionEpoch)
        {
            map.CrustContinentalFraction[triangleIndex] = ScaleUnit(composition);
        }

        // Province sites describe the current stress field. Composition is a
        // property of the transported material column and is therefore only
        // seeded once; subsequent epochs classify the crust from that
        // persistent fraction rather than repainting it from the new Voronoi
        // arrangement.
        map.CrustTypeCodes[triangleIndex] =
            map.CrustContinentalFraction[triangleIndex] >= 500
                ? PhysicalCrustTypeCodes.Continental
                : PhysicalCrustTypeCodes.Oceanic;
        AssignBoundary(map, context.Profile, sites, triangleIndex, selection);
    }

    private static void AssignInitialAssembly(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        ReadOnlySpan<ProvinceSite> sites,
        SiteSelection selection,
        ProvinceSite site,
        int triangleIndex,
        double composition,
        bool riftedMargin)
    {
        if (!context.IsEvolutionEpoch)
        {
            map.CrustAssemblyIds[triangleIndex] = InitialAssemblyId(
                sites,
                selection,
                site,
                composition,
                riftedMargin);
        }
    }

    private static int InitialAssemblyId(
        ReadOnlySpan<ProvinceSite> sites,
        SiteSelection selection,
        ProvinceSite site,
        double composition,
        bool riftedMargin)
    {
        if (riftedMargin || composition <= 0d)
        {
            return 0;
        }

        return site.AssemblyId > 0
            ? site.AssemblyId
            : sites[selection.NearestContinental].AssemblyId;
    }

    private static SamplePoint WarpedSample(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        int triangleIndex)
    {
        var x = map.Grid.TriangleX(triangleIndex);
        var y = map.Grid.TriangleY(triangleIndex);
        var warpX = PhysicalNoise.FractalNoise(
            x,
            y,
            context.Seed ^ 0x16f1,
            context.Profile.ContinentalWarpScale,
            3) * context.Profile.ContinentalWarpStrength;
        var warpY = PhysicalNoise.FractalNoise(
            x,
            y,
            context.Seed ^ 0x62bd,
            context.Profile.ContinentalWarpScale,
            3) * context.Profile.ContinentalWarpStrength;
        return new SamplePoint(x + warpX, y + warpY);
    }

    private static SiteSelection SelectSites(
        ReadOnlySpan<ProvinceSite> sites,
        double sampleX,
        double sampleY)
    {
        var nearest = -1;
        var second = -1;
        var nearestDistance = double.MaxValue;
        var secondDistance = double.MaxValue;
        var nearestContinental = -1;
        var continentalDistance = double.MaxValue;
        var oceanicDistance = double.MaxValue;
        for (var siteIndex = 0; siteIndex < sites.Length; siteIndex++)
        {
            var distance = Distance(sampleX, sampleY, sites[siteIndex].X, sites[siteIndex].Y);
            if (sites[siteIndex].Continental)
            {
                if (distance < continentalDistance)
                {
                    nearestContinental = siteIndex;
                    continentalDistance = distance;
                }
            }
            else
            {
                oceanicDistance = Math.Min(oceanicDistance, distance);
            }

            if (distance < nearestDistance)
            {
                second = nearest;
                secondDistance = nearestDistance;
                nearest = siteIndex;
                nearestDistance = distance;
            }
            else if (distance < secondDistance)
            {
                second = siteIndex;
                secondDistance = distance;
            }
        }

        return new SiteSelection(
            nearest,
            second,
            nearestDistance,
            secondDistance,
            nearestContinental,
            continentalDistance,
            oceanicDistance);
    }

    private static void AssignBoundary(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        ReadOnlySpan<ProvinceSite> sites,
        int triangleIndex,
        SiteSelection selection)
    {
        var boundaryAmount = Math.Clamp(
            1d - ((selection.SecondDistance - selection.NearestDistance) /
                Math.Max(0.001d, profile.RidgeWidth * 1.8d)),
            0d,
            1d);
        if (boundaryAmount <= 0d || selection.Second < 0)
        {
            map.TectonicBoundaryCodes[triangleIndex] = PhysicalTectonicBoundaryCodes.None;
            map.TectonicStrain[triangleIndex] = 0;
            map.TectonicBoundaryPairIds[triangleIndex] = 0;
            map.TectonicTangentX[triangleIndex] = 0;
            map.TectonicTangentY[triangleIndex] = 0;
            return;
        }

        var relativeMotion = RelativeMotion(sites, selection);
        var boundary = BoundaryCode(relativeMotion, profile.TectonicConvergenceThreshold);
        map.TectonicBoundaryCodes[triangleIndex] = boundary;
        map.TectonicBoundaryPairIds[triangleIndex] = BoundaryPairId(selection);
        map.TectonicStrain[triangleIndex] = ScaleUnit(
            boundaryAmount * Math.Clamp(0.48d + Math.Abs(relativeMotion), 0d, 1d));
        AssignBoundaryTangent(map, sites, triangleIndex, selection);
    }

    private static int BoundaryPairId(SiteSelection selection)
    {
        var first = Math.Min(selection.Nearest, selection.Second) + 1;
        var second = Math.Max(selection.Nearest, selection.Second) + 1;
        return (first << 16) | second;
    }

    private static void AssignBoundaryTangent(
        PhysicalGeographyField map,
        ReadOnlySpan<ProvinceSite> sites,
        int triangleIndex,
        SiteSelection selection)
    {
        var first = sites[selection.Nearest];
        var second = sites[selection.Second];
        var normalX = second.X - first.X;
        var normalY = second.Y - first.Y;
        var length = Math.Max(0.001d, Math.Sqrt((normalX * normalX) + (normalY * normalY)));
        var tangentX = -normalY / length;
        var tangentY = normalX / length;

        // A canonical sign prevents the same boundary from reversing its
        // sampling frame when nearest and second-nearest sites exchange.
        if (tangentX < 0d || (Math.Abs(tangentX) < 0.000001d && tangentY < 0d))
        {
            tangentX = -tangentX;
            tangentY = -tangentY;
        }

        map.TectonicTangentX[triangleIndex] = ScaleMotion(tangentX);
        map.TectonicTangentY[triangleIndex] = ScaleMotion(tangentY);
    }

    /// <summary>
    /// Whether these two continental assemblies are on a collision course.
    /// Fixed per pair for the whole world, so a collision that begins in one
    /// epoch keeps closing in the next instead of flickering.
    /// </summary>
    /// <summary>
    /// The gap between two continental assemblies, which they get only if they
    /// are moving apart.
    ///
    /// Which of the two happens is already decided by how the plates move, so
    /// it is read rather than rolled. Assemblies drifting apart rift, and ocean
    /// belongs in the widening gap - that is what keeps the world from being a
    /// single supercontinent, and it is why this separation exists at all.
    /// Assemblies driving into each other have nowhere to put a gap: they weld,
    /// and the suture ends up inland because the merged landmass runs past it
    /// on both sides.
    /// </summary>
    private static double AssemblyGap(
        PhysicalGeographyGenerationContext context,
        ReadOnlySpan<ProvinceSite> sites,
        SiteSelection selection)
    {
        var raw = InterAssemblySeparation(sites, selection, context.Profile);
        var converging = raw > 0d &&
            RelativeMotion(sites, selection) < -context.Profile.TectonicConvergenceThreshold;
        return converging ? 0d : raw;
    }

    /// <summary>
    /// Closing rate of the two plates resolved onto the line joining them.
    /// Negative is approach. This is the same quantity that classifies the
    /// boundary, so what a boundary does and what it is stay consistent.
    /// </summary>
    private static double RelativeMotion(
        ReadOnlySpan<ProvinceSite> sites,
        SiteSelection selection)
    {
        if (selection.Second < 0)
        {
            return 0d;
        }

        var first = sites[selection.Nearest];
        var second = sites[selection.Second];
        var dx = second.X - first.X;
        var dy = second.Y - first.Y;
        var length = Math.Max(0.001d, Math.Sqrt((dx * dx) + (dy * dy)));
        return ((second.MotionX - first.MotionX) * dx / length) +
            ((second.MotionY - first.MotionY) * dy / length);
    }

    private static double InterAssemblySeparation(
        ReadOnlySpan<ProvinceSite> sites,
        SiteSelection selection,
        PhysicalGeographyGenerationProfile profile)
    {
        if (selection.Second < 0 ||
            sites[selection.Nearest].AssemblyId == 0 ||
            sites[selection.Second].AssemblyId == 0 ||
            sites[selection.Nearest].AssemblyId == sites[selection.Second].AssemblyId)
        {
            return 0d;
        }

        var amount = Math.Clamp(
            1d - ((selection.SecondDistance - selection.NearestDistance) /
                Math.Max(0.001d, profile.RidgeWidth * 2.8d)),
            0d,
            1d);
        return amount * profile.ContinentalAssemblySeparationDepth;
    }

    private static int BoundaryCode(double relativeMotion, double threshold)
    {
        if (relativeMotion < -threshold)
        {
            return PhysicalTectonicBoundaryCodes.Convergent;
        }

        return relativeMotion > threshold
            ? PhysicalTectonicBoundaryCodes.Divergent
            : PhysicalTectonicBoundaryCodes.Transform;
    }

    private static int ScaleMotion(double value) =>
        (int)Math.Round(Math.Clamp(value, -1d, 1d) * 1000d, MidpointRounding.AwayFromZero);

    private static int ScaleUnit(double value) =>
        (int)Math.Round(Math.Clamp(value, 0d, 1d) * 1000d, MidpointRounding.AwayFromZero);

    private static double Distance(double ax, double ay, double bx, double by)
    {
        var dx = ax - bx;
        var dy = ay - by;
        return Math.Sqrt((dx * dx) + (dy * dy));
    }

    private static double DistanceSquared(SiteCandidate first, SiteCandidate second)
    {
        var dx = first.X - second.X;
        var dy = first.Y - second.Y;
        return (dx * dx) + (dy * dy);
    }

    private static double Lerp(double first, double second, double amount) =>
        first + ((second - first) * amount);

    private readonly record struct SiteCandidate(double X, double Y, double Priority);

    private readonly record struct SamplePoint(double X, double Y);

    private readonly record struct AssemblyDirection(double X, double Y);

    private readonly record struct SiteSelection(
        int Nearest,
        int Second,
        double NearestDistance,
        double SecondDistance,
        int NearestContinental,
        double ContinentalDistance,
        double OceanicDistance);

    private readonly record struct ProvinceSite(
        double X,
        double Y,
        int AssemblyId,
        double MotionX,
        double MotionY)
    {
        public bool Continental => AssemblyId > 0;
    }

    private sealed class ProvinceMeasurements
    {
        private readonly HashSet<int> _provinces = [];
        private int _boundaries;
        private int _continental;
        private int _oceanic;

        public bool IsComplete =>
            _provinces.Count >= 4 && _boundaries > 0 && _continental > 0 && _oceanic > 0;

        public void Add(PhysicalGeographyField map, int triangleIndex, int epochIndex)
        {
            _provinces.Add(map.CrustProvinceIds[triangleIndex]);
            if (map.CrustTypeCodes[triangleIndex] == PhysicalCrustTypeCodes.Continental &&
                map.CrustAssemblyIds[triangleIndex] <= 0)
            {
                throw new InvalidOperationException(
                    $"Continental crust at triangle {triangleIndex} in epoch {epochIndex} " +
                    $"lacks an assembly identity (fraction " +
                    $"{map.CrustContinentalFraction[triangleIndex]}, source " +
                    $"{map.AdvectionSourceIndex[triangleIndex]}).");
            }

            _continental += map.CrustTypeCodes[triangleIndex] == PhysicalCrustTypeCodes.Continental ? 1 : 0;
            _oceanic += map.CrustTypeCodes[triangleIndex] == PhysicalCrustTypeCodes.Oceanic ? 1 : 0;
            _boundaries += map.TectonicBoundaryCodes[triangleIndex] !=
                PhysicalTectonicBoundaryCodes.None ? 1 : 0;
        }
    }
}
