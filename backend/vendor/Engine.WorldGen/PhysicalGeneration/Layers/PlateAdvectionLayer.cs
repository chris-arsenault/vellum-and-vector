namespace Engine.WorldGen;

using Engine.Constants;

/// <summary>
/// Conservatively transports persistent crustal material between epochs.
/// Every equal-area source triangle scatters one column across nearby target
/// triangles in world space. Ordinary translation is normalized back to one
/// column, convergence may accumulate excess column mass, and divergence is
/// completed with new age-zero oceanic crust.
/// </summary>
internal sealed class PlateAdvectionLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "plate-advection",
        0,
        PhysicalGeographyFacts.TectonicProvinces |
        PhysicalGeographyFacts.ContinentalSutures |
        PhysicalGeographyFacts.LandscapeHistory,
        PhysicalGeographyFacts.LandscapeHistory,
        PhysicalGeographyFacts.OrogenicConstruction |
        PhysicalGeographyFacts.CrustalSupport |
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.TectonicMargins |
        PhysicalGeographyFacts.ContinentalDomains |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.Landmasses |
        PhysicalGeographyFacts.Landforms |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        var decay = Math.Pow(
            context.Profile.PlateDriftDecay / 1000d,
            Math.Max(0, context.EpochIndex));
        var step = map.Grid.ContentRadius *
            (context.Profile.PlateDriftPerEpoch / 1000d) * decay;
        map.AdvectionSourceIndex.Fill(-1);
        map.ConvergentCrustSurplus.Clear();
        map.LastPlateDriftStep = step;
        if (step <= 0d)
        {
            return;
        }

        var before = HistorySnapshot.Capture(map);
        var transport = MaterialTransportPlan.Build(map, step);
        AdvectHistory(map, before, transport);
        map.AccumulatedPlateDrift += step;
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        LandscapeSurface.Validate(map);
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var source = map.AdvectionSourceIndex[triangleIndex];
            if (source >= map.Grid.TriangleCount || MaterialStateIsInvalid(map, triangleIndex) ||
                map.CrustThickness[triangleIndex] <
                    PhysicalElevation.FromUnits(PhysicalCrust.MinimumThicknessUnits) ||
                map.CrustThickness[triangleIndex] >
                    PhysicalElevation.FromUnits(PhysicalCrust.MaximumThicknessUnits))
            {
                throw new InvalidOperationException("Plate advection produced invalid material state.");
            }
        }
    }

    private static bool MaterialStateIsInvalid(PhysicalGeographyField map, int triangleIndex) =>
        map.CrustContinentalFraction[triangleIndex] is < 0 or > 1000 ||
        map.CrustSutureStrength[triangleIndex] is < 0 or > 1000 ||
        (map.CrustSutureStrength[triangleIndex] == 0) !=
            (map.CrustSuturePairIds[triangleIndex] == 0) ||
        map.CrustAge[triangleIndex] is < 0 or > 1000;

    private static void AdvectHistory(
        PhysicalGeographyField map,
        HistorySnapshot before,
        MaterialTransportPlan transport)
    {
        transport.Transport(before, map);

        var minimumThickness = PhysicalElevation.FromUnits(PhysicalCrust.MinimumThicknessUnits);
        var maximumThickness = PhysicalElevation.FromUnits(PhysicalCrust.MaximumThicknessUnits);
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            map.CrustThickness[triangleIndex] = Math.Clamp(
                map.CrustThickness[triangleIndex],
                minimumThickness,
                maximumThickness);
            map.AdvectionSourceIndex[triangleIndex] = transport.DominantSource[triangleIndex];
            LandscapeSurface.Rebuild(map, triangleIndex);
        }
    }

    /// <summary>
    /// Persistent per-column state. Support, climate, drainage, current ice,
    /// and other derived facts are rebuilt after transport and are absent by
    /// design.
    /// </summary>
    private sealed record HistorySnapshot(
        long[] Bedrock,
        long[] Thickness,
        long[] Support,
        long[] SurfaceRockLoad,
        int[] ContinentalFraction,
        int[] AssemblyId,
        int[] SuturePairId,
        int[] SutureStrength,
        int[] CrustAge,
        int[] Resistance,
        long[] Sediment,
        long[] SedimentSupply,
        long[] Fluvial,
        long[] GlacialErosion,
        long[] GlacialDeposition,
        long[] Coastal,
        long[] Deposition,
        long[] Excavation,
        long[] Rim,
        long[] Ejecta,
        long[] Volcanic,
        int[] Tectonic,
        int[] Geothermal,
        int[] Wave,
        int[] MaximumIce,
        int[] MaximumFlux,
        int[] MaximumGrounded,
        int[] VolcanicEpoch,
        int[] ImpactHeat,
        int[] CoastalForcing,
        int[] FeatureFlags)
    {
        public static HistorySnapshot Capture(PhysicalGeographyField map) => new(
            map.BedrockElevation.ToArray(),
            map.CrustThickness.ToArray(),
            map.CrustSupportElevation.ToArray(),
            map.SurfaceRockLoad.ToArray(),
            map.CrustContinentalFraction.ToArray(),
            map.CrustAssemblyIds.ToArray(),
            map.CrustSuturePairIds.ToArray(),
            map.CrustSutureStrength.ToArray(),
            map.CrustAge.ToArray(),
            map.RockResistance.ToArray(),
            map.SedimentThickness.ToArray(),
            map.SedimentSupply.ToArray(),
            map.CumulativeFluvialErosion.ToArray(),
            map.CumulativeGlacialErosion.ToArray(),
            map.CumulativeGlacialDeposition.ToArray(),
            map.CumulativeCoastalErosion.ToArray(),
            map.CumulativeDeposition.ToArray(),
            map.ImpactExcavation.ToArray(),
            map.ImpactRimUplift.ToArray(),
            map.ImpactEjectaThickness.ToArray(),
            map.VolcanicConstructionHistory.ToArray(),
            map.TectonicActivityHistory.ToArray(),
            map.GeothermalHistory.ToArray(),
            map.WaveExposureHistory.ToArray(),
            map.MaximumIceThickness.ToArray(),
            map.MaximumIceFlux.ToArray(),
            map.MaximumGroundedIceFlux.ToArray(),
            map.VolcanicLastActiveEpoch.ToArray(),
            map.ImpactHeat.ToArray(),
            map.ExternalCoastalForcingHistory.ToArray(),
            map.FeatureFlags.ToArray());
    }

    private sealed class MaterialTransportPlan
    {
        private const int WeightScale = 1_000_000;
        private const int MaximumTargetsPerSource = 4;
        private const int MinimumFlagWeight = WeightScale / 20;

        private readonly int[] _targets;
        private readonly int[] _weights;
        private readonly int[] _arrivalWeights;

        private MaterialTransportPlan(
            int[] targets,
            int[] weights,
            int[] arrivalWeights,
            int[] dominantSource)
        {
            _targets = targets;
            _weights = weights;
            _arrivalWeights = arrivalWeights;
            DominantSource = dominantSource;
        }

        public int[] DominantSource { get; }

        public static MaterialTransportPlan Build(PhysicalGeographyField map, double step)
        {
            var count = map.Grid.TriangleCount;
            var targets = new int[checked(count * MaximumTargetsPerSource)];
            Array.Fill(targets, -1);
            var weights = new int[targets.Length];
            var arrivals = new int[count];
            var dominantSource = new int[count];
            var dominantWeight = new int[count];
            Array.Fill(dominantSource, -1);

            for (var source = 0; source < count; source++)
            {
                var destinationX = map.Grid.TriangleX(source) +
                    ((map.CrustMotionX[source] / 1000d) * step);
                var destinationY = map.Grid.TriangleY(source) +
                    ((map.CrustMotionY[source] / 1000d) * step);
                ScatterSource(
                    map.Grid,
                    source,
                    destinationX,
                    destinationY,
                    targets,
                    weights,
                    arrivals,
                    dominantSource,
                    dominantWeight);
            }

            return new MaterialTransportPlan(
                targets,
                weights,
                arrivals,
                dominantSource);
        }

        public void Transport(HistorySnapshot source, PhysicalGeographyField destination)
        {
            var accumulator = new TransportAccumulator(destination.Grid.TriangleCount);
            for (var sourceIndex = 0; sourceIndex < destination.Grid.TriangleCount; sourceIndex++)
            {
                var offset = sourceIndex * MaximumTargetsPerSource;
                for (var slot = 0; slot < MaximumTargetsPerSource; slot++)
                {
                    var target = _targets[offset + slot];
                    if (target >= 0)
                    {
                        accumulator.Add(
                            source,
                            sourceIndex,
                            target,
                            _weights[offset + slot],
                            MinimumFlagWeight);
                    }
                }
            }

            accumulator.Complete(destination, _arrivalWeights);
        }

        private sealed class TransportAccumulator
        {
            private readonly long[] _bedrock;
            private readonly long[] _thickness;
            private readonly long[] _support;
            private readonly long[] _surfaceRockLoad;
            private readonly long[] _continentalFraction;
            private readonly long[] _crustAge;
            private readonly long[] _resistance;
            private readonly long[] _sediment;
            private readonly long[] _sedimentSupply;
            private readonly long[] _fluvial;
            private readonly long[] _glacialErosion;
            private readonly long[] _glacialDeposition;
            private readonly long[] _coastal;
            private readonly long[] _deposition;
            private readonly long[] _excavation;
            private readonly long[] _rim;
            private readonly long[] _ejecta;
            private readonly long[] _volcanic;
            private readonly long[] _tectonic;
            private readonly int[] _geothermal;
            private readonly int[] _wave;
            private readonly int[] _maximumIce;
            private readonly int[] _maximumFlux;
            private readonly int[] _maximumGrounded;
            private readonly long[] _impactHeat;
            private readonly int[] _coastalForcing;
            private readonly int[] _assemblyId;
            private readonly long[] _assemblyContribution;
            private readonly int[] _suturePairId;
            private readonly long[] _sutureContribution;
            private readonly long[] _sutureStrength;
            private readonly int[] _volcanicEpoch;
            private readonly int[] _featureFlags;

            public TransportAccumulator(int count)
            {
                _bedrock = new long[count];
                _thickness = new long[count];
                _support = new long[count];
                _surfaceRockLoad = new long[count];
                _continentalFraction = new long[count];
                _crustAge = new long[count];
                _resistance = new long[count];
                _sediment = new long[count];
                _sedimentSupply = new long[count];
                _fluvial = new long[count];
                _glacialErosion = new long[count];
                _glacialDeposition = new long[count];
                _coastal = new long[count];
                _deposition = new long[count];
                _excavation = new long[count];
                _rim = new long[count];
                _ejecta = new long[count];
                _volcanic = new long[count];
                _tectonic = new long[count];
                _geothermal = new int[count];
                _wave = new int[count];
                _maximumIce = new int[count];
                _maximumFlux = new int[count];
                _maximumGrounded = new int[count];
                _impactHeat = new long[count];
                _coastalForcing = new int[count];
                _assemblyId = new int[count];
                _assemblyContribution = new long[count];
                _suturePairId = new int[count];
                _sutureContribution = new long[count];
                _sutureStrength = new long[count];
                _volcanicEpoch = new int[count];
                Array.Fill(_volcanicEpoch, -1);
                _featureFlags = new int[count];
            }

            public void Add(
                HistorySnapshot source,
                int sourceIndex,
                int target,
                int weight,
                int minimumFlagWeight)
            {
                AddWeighted(_bedrock, target, source.Bedrock[sourceIndex], weight);
                AddWeighted(_thickness, target, source.Thickness[sourceIndex], weight);
                AddWeighted(_support, target, source.Support[sourceIndex], weight);
                AddWeighted(_surfaceRockLoad, target, source.SurfaceRockLoad[sourceIndex], weight);
                AddWeighted(_continentalFraction, target, source.ContinentalFraction[sourceIndex], weight);
                AddWeighted(_sutureStrength, target, source.SutureStrength[sourceIndex], weight);
                AddWeighted(_crustAge, target, source.CrustAge[sourceIndex], weight);
                AddWeighted(_resistance, target, source.Resistance[sourceIndex], weight);
                AddWeighted(_sediment, target, source.Sediment[sourceIndex], weight);
                AddWeighted(_sedimentSupply, target, source.SedimentSupply[sourceIndex], weight);
                AddWeighted(_fluvial, target, source.Fluvial[sourceIndex], weight);
                AddWeighted(_glacialErosion, target, source.GlacialErosion[sourceIndex], weight);
                AddWeighted(_glacialDeposition, target, source.GlacialDeposition[sourceIndex], weight);
                AddWeighted(_coastal, target, source.Coastal[sourceIndex], weight);
                AddWeighted(_deposition, target, source.Deposition[sourceIndex], weight);
                AddWeighted(_excavation, target, source.Excavation[sourceIndex], weight);
                AddWeighted(_rim, target, source.Rim[sourceIndex], weight);
                AddWeighted(_ejecta, target, source.Ejecta[sourceIndex], weight);
                AddWeighted(_volcanic, target, source.Volcanic[sourceIndex], weight);
                AddWeighted(_tectonic, target, source.Tectonic[sourceIndex], weight);
                AddWeighted(_impactHeat, target, source.ImpactHeat[sourceIndex], weight);
                AddCategorical(source, sourceIndex, target, weight, minimumFlagWeight);
            }

            public void Complete(PhysicalGeographyField map, ReadOnlySpan<int> arrivals)
            {
                for (var target = 0; target < arrivals.Length; target++)
                {
                    var boundary = map.TectonicBoundaryCodes[target];
                    CompleteCrustAndSurface(map, target, arrivals[target], boundary);
                    CompleteMaterialHistory(map, target, arrivals[target], boundary);
                    CompleteScalarHistory(map, target, arrivals[target], boundary);
                    map.CrustAssemblyIds[target] = map.CrustContinentalFraction[target] > 0
                        ? _assemblyId[target]
                        : 0;
                    map.CrustSutureStrength[target] = ToInt(FinalizeIntensive(
                        _sutureStrength[target], arrivals[target], 0, boundary));
                    map.CrustSuturePairIds[target] = map.CrustSutureStrength[target] > 0
                        ? _suturePairId[target]
                        : 0;
                    map.VolcanicLastActiveEpoch[target] = _volcanicEpoch[target];
                    map.FeatureFlags[target] = _featureFlags[target];
                    ReconcileCategoricalProvenance(map, target);
                }
            }

            private static void ReconcileCategoricalProvenance(
                PhysicalGeographyField map,
                int target)
            {
                if (map.VolcanicConstructionHistory[target] > 0)
                {
                    return;
                }

                map.FeatureFlags[target] &= ~(
                    PhysicalGeographyFeatureCodes.VolcanicCone |
                    PhysicalGeographyFeatureCodes.VolcanicCaldera |
                    PhysicalGeographyFeatureCodes.LavaPlain);
                map.VolcanicLastActiveEpoch[target] = -1;
            }

            private void CompleteCrustAndSurface(
                PhysicalGeographyField map,
                int target,
                int arrival,
                int boundary)
            {
                var freshThickness = PhysicalElevation.FromUnits(PhysicalCrust.OceanicThicknessUnits);
                var freshBedrock = PhysicalElevation.FromUnits(
                    PhysicalCrust.HeightUnits(PhysicalCrust.OceanicThicknessUnits, 0d));
                map.BedrockElevation[target] = FinalizeIntensive(
                    _bedrock[target], arrival, freshBedrock, boundary);
                map.CrustThickness[target] = FinalizeIntensive(
                    _thickness[target], arrival, freshThickness, boundary);
                map.ConvergentCrustSurplus[target] = ConvergentSurplus(
                    _thickness[target], arrival, boundary);
                map.CrustSupportElevation[target] = FinalizeIntensive(
                    _support[target], arrival, freshBedrock, boundary);
                map.SurfaceRockLoad[target] = FinalizeExtensive(
                    _surfaceRockLoad[target], arrival, 0, boundary);
                map.CrustContinentalFraction[target] = ToInt(
                    FinalizeIntensive(_continentalFraction[target], arrival, 0, boundary));
                map.CrustAge[target] = ToInt(FinalizeIntensive(_crustAge[target], arrival, 0, boundary));
                map.RockResistance[target] = ToInt(FinalizeIntensive(
                    _resistance[target], arrival, PhysicalRock.BaselineResistance, boundary));
                map.SedimentThickness[target] = FinalizeExtensive(
                    _sediment[target], arrival, 0, boundary);
                map.SedimentSupply[target] = FinalizeExtensive(
                    _sedimentSupply[target], arrival, 0, boundary);
            }

            private static long ConvergentSurplus(
                long accumulated,
                int arrivalWeight,
                int boundaryCode)
            {
                if (boundaryCode != PhysicalTectonicBoundaryCodes.Convergent ||
                    arrivalWeight <= WeightScale)
                {
                    return 0;
                }

                var normalizedColumn = accumulated / arrivalWeight;
                return checked(accumulated - (normalizedColumn * WeightScale)) / WeightScale;
            }

            private void CompleteMaterialHistory(
                PhysicalGeographyField map,
                int target,
                int arrival,
                int boundary)
            {
                map.CumulativeFluvialErosion[target] = FinalizeExtensive(
                    _fluvial[target], arrival, 0, boundary);
                map.CumulativeGlacialErosion[target] = FinalizeExtensive(
                    _glacialErosion[target], arrival, 0, boundary);
                map.CumulativeGlacialDeposition[target] = FinalizeExtensive(
                    _glacialDeposition[target], arrival, 0, boundary);
                map.CumulativeCoastalErosion[target] = FinalizeExtensive(
                    _coastal[target], arrival, 0, boundary);
                map.CumulativeDeposition[target] = FinalizeExtensive(
                    _deposition[target], arrival, 0, boundary);
                map.ImpactExcavation[target] = FinalizeExtensive(
                    _excavation[target], arrival, 0, boundary);
                map.ImpactRimUplift[target] = FinalizeExtensive(_rim[target], arrival, 0, boundary);
                map.ImpactEjectaThickness[target] = FinalizeExtensive(
                    _ejecta[target], arrival, 0, boundary);
                map.VolcanicConstructionHistory[target] = FinalizeExtensive(
                    _volcanic[target], arrival, 0, boundary);
            }

            private void CompleteScalarHistory(
                PhysicalGeographyField map,
                int target,
                int arrival,
                int boundary)
            {
                map.TectonicActivityHistory[target] = ToInt(FinalizeExtensive(
                    _tectonic[target], arrival, 0, boundary));
                map.GeothermalHistory[target] = _geothermal[target];
                map.WaveExposureHistory[target] = _wave[target];
                map.MaximumIceThickness[target] = _maximumIce[target];
                map.MaximumIceFlux[target] = _maximumFlux[target];
                map.MaximumGroundedIceFlux[target] = _maximumGrounded[target];
                map.ImpactHeat[target] = ToInt(FinalizeIntensive(
                    _impactHeat[target], arrival, 0, boundary));
                map.ExternalCoastalForcingHistory[target] = _coastalForcing[target];
            }

            private void AddCategorical(
                HistorySnapshot source,
                int sourceIndex,
                int target,
                int weight,
                int minimumFlagWeight)
            {
                var assemblyId = source.AssemblyId[sourceIndex];
                var continentalFraction = source.ContinentalFraction[sourceIndex];
                var contribution = checked((long)weight * continentalFraction);
                if (assemblyId > 0 && continentalFraction > 0 &&
                    (contribution > _assemblyContribution[target] ||
                        contribution == _assemblyContribution[target] && assemblyId < _assemblyId[target]))
                {
                    _assemblyId[target] = assemblyId;
                    _assemblyContribution[target] = contribution;
                }

                AddSutureCategorical(source, sourceIndex, target, weight);

                _maximumIce[target] = Math.Max(
                    _maximumIce[target],
                    source.MaximumIce[sourceIndex]);
                _maximumFlux[target] = Math.Max(
                    _maximumFlux[target],
                    source.MaximumFlux[sourceIndex]);
                _maximumGrounded[target] = Math.Max(
                    _maximumGrounded[target],
                    source.MaximumGrounded[sourceIndex]);
                _geothermal[target] = Math.Max(
                    _geothermal[target],
                    source.Geothermal[sourceIndex]);
                _wave[target] = Math.Max(_wave[target], source.Wave[sourceIndex]);
                _coastalForcing[target] = Math.Max(
                    _coastalForcing[target],
                    source.CoastalForcing[sourceIndex]);

                if (weight >= minimumFlagWeight)
                {
                    _volcanicEpoch[target] = Math.Max(
                        _volcanicEpoch[target],
                        source.VolcanicEpoch[sourceIndex]);
                    _featureFlags[target] |= source.FeatureFlags[sourceIndex];
                }
            }

            private void AddSutureCategorical(
                HistorySnapshot source,
                int sourceIndex,
                int target,
                int weight)
            {
                var pairId = source.SuturePairId[sourceIndex];
                var strength = source.SutureStrength[sourceIndex];
                var contribution = checked((long)weight * strength);
                if (pairId <= 0 || strength <= 0 ||
                    contribution < _sutureContribution[target] ||
                    contribution == _sutureContribution[target] && pairId >= _suturePairId[target])
                {
                    return;
                }

                _suturePairId[target] = pairId;
                _sutureContribution[target] = contribution;
            }

            private static void AddWeighted(
                long[] destination,
                int target,
                long value,
                int weight) =>
                destination[target] = checked(destination[target] + (value * weight));

            private static int ToInt(long value) => checked((int)Math.Clamp(
                value,
                int.MinValue,
                int.MaxValue));

            private static long FinalizeExtensive(
                long accumulated,
                int arrivalWeight,
                long freshValue,
                int boundaryCode)
            {
                if (arrivalWeight <= 0)
                {
                    return freshValue;
                }

                if (boundaryCode == PhysicalTectonicBoundaryCodes.Convergent &&
                    arrivalWeight > WeightScale)
                {
                    return accumulated / WeightScale;
                }

                if (boundaryCode == PhysicalTectonicBoundaryCodes.Divergent &&
                    arrivalWeight < WeightScale)
                {
                    return checked(
                        accumulated + (freshValue * (WeightScale - arrivalWeight))) / WeightScale;
                }

                return accumulated / arrivalWeight;
            }

            private static long FinalizeIntensive(
                long accumulated,
                int arrivalWeight,
                long freshValue,
                int boundaryCode)
            {
                if (arrivalWeight <= 0)
                {
                    return freshValue;
                }

                if (boundaryCode == PhysicalTectonicBoundaryCodes.Divergent &&
                    arrivalWeight < WeightScale)
                {
                    return checked(
                        accumulated + (freshValue * (WeightScale - arrivalWeight))) / WeightScale;
                }

                return accumulated / arrivalWeight;
            }
        }

        private static void ScatterSource(
            PhysicalGeographyGrid grid,
            int source,
            double destinationX,
            double destinationY,
            int[] targets,
            int[] weights,
            int[] arrivals,
            int[] dominantSource,
            int[] dominantWeight)
        {
            if (!grid.TryFindNearestTriangle(destinationX, destinationY, out var nearest))
            {
                return;
            }

            Span<int> candidates = stackalloc int[MaximumTargetsPerSource];
            Span<double> scores = stackalloc double[MaximumTargetsPerSource];
            var candidateCount = CollectCandidates(grid, nearest, candidates);

            var nearestDistanceSquared = DistanceSquared(
                grid,
                nearest,
                destinationX,
                destinationY);
            if (nearestDistanceSquared < 0.00000001d)
            {
                AddContribution(
                    source,
                    0,
                    nearest,
                    WeightScale,
                    targets,
                    weights,
                    arrivals,
                    dominantSource,
                    dominantWeight);
                return;
            }

            var scoreTotal = ScoreCandidates(
                grid,
                candidates[..candidateCount],
                scores,
                destinationX,
                destinationY);
            ScatterWeightedCandidates(
                source,
                candidates[..candidateCount],
                scores,
                scoreTotal,
                targets,
                weights,
                arrivals,
                dominantSource,
                dominantWeight);
        }

        private static int CollectCandidates(
            PhysicalGeographyGrid grid,
            int nearest,
            Span<int> candidates)
        {
            candidates.Fill(-1);
            candidates[0] = nearest;
            var count = 1;
            for (var edge = 0; edge < 3; edge++)
            {
                var neighbor = grid.NeighborTriangleIndex(nearest, edge);
                if (neighbor >= 0)
                {
                    candidates[count++] = neighbor;
                }
            }

            return count;
        }

        private static double ScoreCandidates(
            PhysicalGeographyGrid grid,
            ReadOnlySpan<int> candidates,
            Span<double> scores,
            double destinationX,
            double destinationY)
        {
            var total = 0d;
            for (var candidateIndex = 0; candidateIndex < candidates.Length; candidateIndex++)
            {
                var distanceSquared = Math.Max(
                    0.0025d,
                    DistanceSquared(
                        grid,
                        candidates[candidateIndex],
                        destinationX,
                        destinationY));
                scores[candidateIndex] = 1d / (distanceSquared * distanceSquared);
                total += scores[candidateIndex];
            }

            return total;
        }

        private static void ScatterWeightedCandidates(
            int source,
            ReadOnlySpan<int> candidates,
            ReadOnlySpan<double> scores,
            double scoreTotal,
            int[] targets,
            int[] weights,
            int[] arrivals,
            int[] dominantSource,
            int[] dominantWeight)
        {
            var remaining = WeightScale;
            for (var candidateIndex = 0; candidateIndex < candidates.Length; candidateIndex++)
            {
                var weight = candidateIndex == candidates.Length - 1
                    ? remaining
                    : Math.Clamp(
                        (int)Math.Round(
                            WeightScale * scores[candidateIndex] / scoreTotal,
                            MidpointRounding.AwayFromZero),
                        0,
                        remaining);
                remaining -= weight;
                AddContribution(
                    source,
                    candidateIndex,
                    candidates[candidateIndex],
                    weight,
                    targets,
                    weights,
                    arrivals,
                    dominantSource,
                    dominantWeight);
            }
        }

        private static void AddContribution(
            int source,
            int slot,
            int target,
            int weight,
            int[] targets,
            int[] weights,
            int[] arrivals,
            int[] dominantSource,
            int[] dominantWeight)
        {
            if (weight <= 0)
            {
                return;
            }

            var offset = (source * MaximumTargetsPerSource) + slot;
            targets[offset] = target;
            weights[offset] = weight;
            arrivals[target] = checked(arrivals[target] + weight);
            if (weight > dominantWeight[target] ||
                weight == dominantWeight[target] && source < dominantSource[target])
            {
                dominantSource[target] = source;
                dominantWeight[target] = weight;
            }
        }

        private static double DistanceSquared(
            PhysicalGeographyGrid grid,
            int triangleIndex,
            double x,
            double y)
        {
            var dx = grid.TriangleX(triangleIndex) - x;
            var dy = grid.TriangleY(triangleIndex) - y;
            return (dx * dx) + (dy * dy);
        }
    }
}
