namespace Engine.WorldGen;

using System.Runtime.CompilerServices;

using Engine.Constants;

/// <summary>
/// Dense generation-time indexing for one global equilateral microtriangle
/// lattice. Neighboring centroids are exactly one generation distance unit
/// apart. Coarser runtime cells are deliberately absent from this model.
/// </summary>
public sealed class PhysicalGeographyGrid
{
    private const double RootThree = 1.7320508075688772935d;
    private const double TriangleArea = 1.2990381056766579701d;

    private readonly Dictionary<MicrotriangleCoord, int> _triangleIndexes;
    private readonly MicrotriangleCoord[] _triangleCoords;
    private readonly int[] _triangleNeighbors;
    private readonly float[] _triangleEdgeUnitX;
    private readonly float[] _triangleEdgeUnitY;
    private readonly float[] _triangleX;
    private readonly float[] _triangleY;
    private readonly bool[] _workBoundary;

    public PhysicalGeographyGrid(int contentTriangleCount, int workTriangleCount)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(contentTriangleCount);
        if (workTriangleCount < contentTriangleCount)
        {
            throw new ArgumentOutOfRangeException(
                nameof(workTriangleCount),
                "The work domain must contain the content triangle budget.");
        }

        ContentTriangleCount = contentTriangleCount;
        _triangleCoords = BuildCenteredDomain(workTriangleCount);
        _triangleIndexes = new Dictionary<MicrotriangleCoord, int>(_triangleCoords.Length);
        _triangleX = new float[_triangleCoords.Length];
        _triangleY = new float[_triangleCoords.Length];
        for (var triangleIndex = 0; triangleIndex < _triangleCoords.Length; triangleIndex++)
        {
            _triangleIndexes.Add(_triangleCoords[triangleIndex], triangleIndex);
            WriteCentroid(triangleIndex, _triangleCoords[triangleIndex]);
        }

        _triangleNeighbors = new int[checked(_triangleCoords.Length * 3)];
        Array.Fill(_triangleNeighbors, -1);
        _triangleEdgeUnitX = new float[_triangleNeighbors.Length];
        _triangleEdgeUnitY = new float[_triangleNeighbors.Length];
        _workBoundary = new bool[_triangleCoords.Length];
        BuildTriangleNeighbors();
        BuildTriangleEdgeGeometry();

        ContentRadius = TriangleDistanceFromOrigin(contentTriangleCount - 1);
        WorkRadius = TriangleDistanceFromOrigin(_triangleCoords.Length - 1);
    }

    public static PhysicalGeographyGrid CreateWithPadding(
        int contentTriangleCount,
        int boundaryPaddingSteps)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(boundaryPaddingSteps);
        var contentRadius = Math.Sqrt(contentTriangleCount * TriangleArea / Math.PI);
        var workRadius = contentRadius + boundaryPaddingSteps;
        var workTriangleCount = checked((int)Math.Ceiling(
            Math.PI * workRadius * workRadius / TriangleArea));
        return new PhysicalGeographyGrid(
            contentTriangleCount,
            Math.Max(contentTriangleCount, workTriangleCount));
    }

    public int ContentTriangleCount { get; }

    public int TriangleCount => _triangleX.Length;

    /// <summary>Radius of the requested content budget in microtriangle steps.</summary>
    public double ContentRadius { get; }

    /// <summary>Radius of the padded work graph in microtriangle steps.</summary>
    public double WorkRadius { get; }

    public MicrotriangleCoord TriangleCoordAt(int triangleIndex) => _triangleCoords[triangleIndex];

    /// <summary>
    /// Stable spatial identity for deterministic noise and tie-breaking.
    /// Storage indexes must never act as geography.
    /// </summary>
    public int TriangleIdentity(int triangleIndex)
    {
        var coord = _triangleCoords[triangleIndex];
        return unchecked(
            (coord.U * 73_856_093) ^
            (coord.V * 19_349_663) ^
            (coord.Inverted ? 83_492_791 : 0));
    }

    public int NeighborTriangleIndex(int triangleIndex, int edge) =>
        _triangleNeighbors[checked((triangleIndex * 3) + edge)];

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal float TriangleEdgeUnitX(int triangleIndex, int edge) =>
        _triangleEdgeUnitX[(triangleIndex * 3) + edge];

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal float TriangleEdgeUnitY(int triangleIndex, int edge) =>
        _triangleEdgeUnitY[(triangleIndex * 3) + edge];

    public float TriangleX(int triangleIndex) => _triangleX[triangleIndex];

    public float TriangleY(int triangleIndex) => _triangleY[triangleIndex];

    public double TriangleDistanceFromOrigin(int triangleIndex)
    {
        var x = (double)_triangleX[triangleIndex];
        var y = (double)_triangleY[triangleIndex];
        return Math.Sqrt((x * x) + (y * y));
    }

    public bool TriangleIsInsideContentDomain(int triangleIndex) =>
        (uint)triangleIndex < (uint)ContentTriangleCount;

    public bool TriangleIsOnWorkBoundary(int triangleIndex) => _workBoundary[triangleIndex];

    public bool TryGetTriangleIndex(MicrotriangleCoord coord, out int triangleIndex) =>
        _triangleIndexes.TryGetValue(coord, out triangleIndex);

    /// <summary>
    /// Nearest triangle to a world position. Advection samples in world space
    /// rather than storage-index space.
    /// </summary>
    public bool TryFindNearestTriangle(double x, double y, out int triangleIndex)
    {
        triangleIndex = -1;
        var best = double.MaxValue;
        for (var orientation = 0; orientation < 2; orientation++)
        {
            ConsiderNearestCandidates(
                x,
                y,
                orientation != 0,
                ref triangleIndex,
                ref best);
        }

        return triangleIndex >= 0;
    }

    private void ConsiderNearestCandidates(
        double x,
        double y,
        bool inverted,
        ref int triangleIndex,
        ref double best)
    {
        var offsetX = inverted ? 2d : 1d;
        var sum = (x - offsetX) / 1.5d;
        var difference = (2d * y) / RootThree;
        var centerU = (int)Math.Round(
            (sum - difference) * 0.5d,
            MidpointRounding.AwayFromZero);
        var centerV = (int)Math.Round(
            (sum + difference) * 0.5d,
            MidpointRounding.AwayFromZero);
        for (var du = -2; du <= 2; du++)
        {
            for (var dv = -2; dv <= 2; dv++)
            {
                if (!_triangleIndexes.TryGetValue(
                        new MicrotriangleCoord(centerU + du, centerV + dv, inverted),
                        out var candidate))
                {
                    continue;
                }

                var dx = _triangleX[candidate] - x;
                var dy = _triangleY[candidate] - y;
                var distance = (dx * dx) + (dy * dy);
                if (distance < best)
                {
                    best = distance;
                    triangleIndex = candidate;
                }
            }
        }
    }

    public int EdgeLeadingTo(int triangleIndex, int targetTriangleIndex)
    {
        for (var edge = 0; edge < 3; edge++)
        {
            if (NeighborTriangleIndex(triangleIndex, edge) == targetTriangleIndex)
            {
                return edge;
            }
        }

        return PhysicalGeographyCodes.NoFlowEdge;
    }

    private void BuildTriangleNeighbors()
    {
        for (var triangleIndex = 0; triangleIndex < TriangleCount; triangleIndex++)
        {
            var coord = _triangleCoords[triangleIndex];
            for (var edge = 0; edge < 3; edge++)
            {
                if (_triangleIndexes.TryGetValue(coord.Neighbor(edge), out var neighbor))
                {
                    _triangleNeighbors[(triangleIndex * 3) + edge] = neighbor;
                }
                else
                {
                    _workBoundary[triangleIndex] = true;
                }
            }
        }
    }

    private void BuildTriangleEdgeGeometry()
    {
        for (var triangleIndex = 0; triangleIndex < TriangleCount; triangleIndex++)
        {
            for (var edge = 0; edge < 3; edge++)
            {
                var neighbor = NeighborTriangleIndex(triangleIndex, edge);
                if (neighbor < 0)
                {
                    continue;
                }

                var dx = (double)_triangleX[neighbor] - _triangleX[triangleIndex];
                var dy = (double)_triangleY[neighbor] - _triangleY[triangleIndex];
                var length = Math.Max(0.001d, Math.Sqrt((dx * dx) + (dy * dy)));
                var offset = (triangleIndex * 3) + edge;
                _triangleEdgeUnitX[offset] = (float)(dx / length);
                _triangleEdgeUnitY[offset] = (float)(dy / length);
            }
        }
    }

    private static MicrotriangleCoord[] BuildCenteredDomain(int triangleCount)
    {
        var radius = Math.Sqrt(triangleCount * TriangleArea / Math.PI);
        var coordinateExtent = checked((int)Math.Ceiling((2d * radius) / 3d) + 4);
        var side = checked((coordinateExtent * 2) + 1);
        var candidates = new List<CoordinateCandidate>(checked(side * side * 2));
        for (var u = -coordinateExtent; u <= coordinateExtent; u++)
        {
            for (var v = -coordinateExtent; v <= coordinateExtent; v++)
            {
                AddCandidate(candidates, new MicrotriangleCoord(u, v, false));
                AddCandidate(candidates, new MicrotriangleCoord(u, v, true));
            }
        }

        candidates.Sort(static (first, second) =>
        {
            var distance = first.DistanceSquared.CompareTo(second.DistanceSquared);
            if (distance != 0)
            {
                return distance;
            }

            var u = first.Coord.U.CompareTo(second.Coord.U);
            if (u != 0)
            {
                return u;
            }

            var v = first.Coord.V.CompareTo(second.Coord.V);
            return v != 0
                ? v
                : first.Coord.Inverted.CompareTo(second.Coord.Inverted);
        });
        if (candidates.Count < triangleCount)
        {
            throw new InvalidOperationException("Microtriangle domain enumeration was undersized.");
        }

        var result = new MicrotriangleCoord[triangleCount];
        for (var index = 0; index < result.Length; index++)
        {
            result[index] = candidates[index].Coord;
        }

        return result;
    }

    private static void AddCandidate(
        List<CoordinateCandidate> candidates,
        MicrotriangleCoord coord)
    {
        Centroid(coord, out var x, out var y);
        candidates.Add(new CoordinateCandidate(coord, (x * x) + (y * y)));
    }

    private void WriteCentroid(int triangleIndex, MicrotriangleCoord coord)
    {
        Centroid(coord, out var x, out var y);
        _triangleX[triangleIndex] = (float)x;
        _triangleY[triangleIndex] = (float)y;
    }

    private static void Centroid(MicrotriangleCoord coord, out double x, out double y)
    {
        x = (1.5d * (coord.U + coord.V)) + (coord.Inverted ? 2d : 1d);
        y = (RootThree * 0.5d) * (-coord.U + coord.V);
    }

    private readonly record struct CoordinateCandidate(
        MicrotriangleCoord Coord,
        double DistanceSquared);
}

/// <summary>
/// Whole-field generated physical facts before domain material classification
/// and runtime-map projection.
/// </summary>
public sealed class PhysicalGeographyField
{
    private readonly int[] _crustBasePotential;
    private readonly int[] _crustAssemblyIds;
    private readonly int[] _crustAssemblySeparation;
    private readonly int[] _crustCollisionIntensity;
    private readonly int[] _crustSuturePairIds;
    private readonly int[] _crustSutureStrength;
    private readonly int[] _rockResistance;
    private readonly int[] _crustMotionX;
    private readonly int[] _crustMotionY;
    private readonly int[] _crustProvinceIds;
    private readonly int[] _crustTypeCodes;
    private readonly int[] _crustContinentalFraction;
    private readonly int[] _advectionSourceIndex;
    private readonly int[] _marginCodes;
    private readonly int[] _oceanMarginDistance;
    private readonly int[] _coastalMarginCodes;
    private readonly int[] _crustAge;
    private readonly long[] _bedrockElevation;
    private readonly long[] _crustThickness;
    private readonly long[] _crustSupportElevation;
    private readonly long[] _crustSupportTarget;
    private readonly long[] _surfaceRockLoad;
    private readonly int[] _continentalPotential;
    private readonly long[] _cumulativeCoastalErosion;
    private readonly long[] _cumulativeDeposition;
    private readonly long[] _cumulativeFluvialErosion;
    private readonly long[] _cumulativeGlacialErosion;
    private readonly long[] _cumulativeGlacialDeposition;
    private readonly int[] _drainageBasinIds;
    private readonly int[] _drainageGuidanceTargets;
    private readonly long[] _drainageElevations;
    private readonly int[] _drainageParents;
    private readonly int[] _drainageRanks;
    private readonly long[] _elevation;
    private readonly int[] _featureFlags;
    private readonly int[] _fractureConductance;
    private readonly int[] _flowAccumulation;
    private readonly int[] _flowEdges;
    private readonly int[] _flowTargets;
    private readonly int[] _geothermal;
    private readonly int[] _geothermalHistory;
    private readonly int[] _groundedIce;
    private readonly long[] _impactExcavation;
    private readonly long[] _impactRimUplift;
    private readonly long[] _impactEjectaThickness;
    private readonly int[] _impactHeat;
    private readonly int[] _glacialMeltwater;
    private readonly int[] _heatSourceDensity;
    private readonly int[] _mantlePlumeRootStrength;
    private readonly int[] _volcanicActivity;
    private readonly long[] _volcanicConstructionHistory;
    private readonly int[] _volcanicLastActiveEpoch;
    private readonly int[] _iceFlux;
    private readonly int[] _iceFlowTargets;
    private readonly int[] _iceBalance;
    private readonly int[] _iceThickness;
    private readonly int[] _landmassClassCodes;
    private readonly int[] _landmassIds;
    private readonly int[] _lakeOutletTargets;
    private readonly long[] _lakeOverflow;
    private readonly int[] _landformCodes;
    private readonly int[] _maximumIceFlux;
    private readonly int[] _maximumGroundedIceFlux;
    private readonly int[] _maximumIceThickness;
    private readonly int[] _moisture;
    private readonly int[] _oceanCurrentHeat;
    private readonly int[] _oceanCurrentStrength;
    private readonly int[] _oceanCurrentX;
    private readonly int[] _oceanCurrentY;
    private readonly int[] _oceanDistance;
    private readonly int[] _rainfall;
    private readonly float[] _ridgeInfluence;
    private readonly int[] _riverOrders;
    private readonly int[] _riverChannelStrength;
    private readonly int[] _riverChannelOrders;
    private readonly int[] _floodplainIntensity;
    private readonly int[] _deltaIntensity;
    private readonly int[] _riverSpineEdgeMasks;
    private readonly int[] _runoff;
    private readonly int[] _seaIceSuitability;
    private readonly long[] _sedimentSupply;
    private readonly long[] _sedimentThickness;
    private readonly int[] _snowfall;
    private readonly long[] _slope;
    private readonly int[] _temperature;
    private readonly int[] _windX;
    private readonly int[] _windY;
    private readonly int[] _upwindTargets;
    private readonly int[] _moistureBarriers;
    private readonly int[] _precipitationBarriers;
    private readonly int[] _upwindOceanSources;
    private readonly int[] _tectonicBoundaryCodes;
    private readonly int[] _initialTectonicBoundaryCodes;
    private readonly int[] _initialTectonicStrain;
    private readonly int[] _tectonicStrain;
    private readonly int[] _tectonicBoundaryPairIds;
    private readonly int[] _tectonicTangentX;
    private readonly int[] _tectonicTangentY;
    private readonly int[] _tectonicActivityHistory;
    private readonly int[] _orogenicComponentIds;
    private readonly int[] _orogenicSystemProminence;
    private readonly long[] _orogenicConstruction;
    private readonly long[] _convergentCrustSurplus;
    private readonly int[] _warmth;
    private readonly int[] _waveExposure;
    private readonly int[] _waveExposureHistory;
    private readonly int[] _externalHeatForcing;
    private readonly int[] _externalCoastalForcing;
    private readonly int[] _externalCoastalForcingHistory;
    private readonly int[] _continentalGroupIds;
    private readonly int[] _bathymetricZoneCodes;
    private readonly float[] _uplift;
    private readonly int[] _waterBodyIds;
    private readonly long[] _waterDepths;
    private readonly int[] _waterKindCodes;
    private readonly long[] _waterSurfaceElevations;

    private static (
        int[] Source,
        int[] Margin,
        int[] Age,
        int[] Potential,
        int[] ShoreDistance,
        int[] ShoreMargin) NewCrustFrameFields(PhysicalGeographyGrid grid)
    {
        var shoreDistance = new int[grid.TriangleCount];
        Array.Fill(shoreDistance, -1);
        return (new int[grid.TriangleCount], new int[grid.TriangleCount],
            new int[grid.TriangleCount], new int[grid.TriangleCount],
            shoreDistance, new int[grid.TriangleCount]);
    }

    internal PhysicalGeographyField(PhysicalGeographyGrid grid)
    {
        Grid = grid;
        (_crustBasePotential, _crustAssemblyIds, _crustAssemblySeparation, _crustMotionX,
            _crustMotionY, _crustProvinceIds, _crustTypeCodes, _crustContinentalFraction) =
            (NewField(grid), NewField(grid), NewField(grid), NewField(grid), NewField(grid),
                NewField(grid), NewField(grid), NewField(grid));
        (_advectionSourceIndex, _marginCodes, _crustAge, _continentalPotential,
            _oceanMarginDistance, _coastalMarginCodes) = NewCrustFrameFields(grid);
        (_elevation, _temperature) = (NewElevationField(grid), NewField(grid));
        (_windX, _windY, _upwindTargets, _moistureBarriers,
            _precipitationBarriers, _upwindOceanSources) = NewAtmosphericFields(grid);
        (_tectonicBoundaryCodes, _tectonicStrain, _initialTectonicBoundaryCodes,
            _initialTectonicStrain, _tectonicBoundaryPairIds, _tectonicTangentX, _tectonicTangentY) =
            (NewField(grid), NewField(grid), NewField(grid), NewField(grid),
                NewField(grid), NewField(grid), NewField(grid));
        (_orogenicComponentIds, _orogenicSystemProminence, _orogenicConstruction,
            _convergentCrustSurplus) = NewOrogenicFields(grid);
        (_oceanCurrentX, _oceanCurrentY, _oceanCurrentStrength, _oceanCurrentHeat,
            _waveExposure, _oceanDistance) = NewOceanFields(grid);
        (_rainfall, _snowfall, _seaIceSuitability) = NewTriple(grid);
        (_bedrockElevation, _sedimentThickness, _sedimentSupply, _cumulativeFluvialErosion,
            _cumulativeGlacialErosion, _cumulativeGlacialDeposition,
            _cumulativeCoastalErosion, _cumulativeDeposition, _crustThickness) = NewLandscapeHistoryFields(grid);
        (_crustSupportElevation, _crustSupportTarget, _surfaceRockLoad) = NewSupportFields(grid);
        (_maximumIceThickness, _maximumIceFlux, _tectonicActivityHistory, _waveExposureHistory,
            _geothermalHistory) =
            (NewField(grid), NewField(grid), NewField(grid), NewField(grid), NewField(grid));
        (_impactExcavation, _impactRimUplift, _impactEjectaThickness, _impactHeat, _glacialMeltwater) =
            NewImpactFields(grid);
        (_externalHeatForcing, _externalCoastalForcing, _externalCoastalForcingHistory) =
            (NewField(grid), NewField(grid), NewField(grid));
        (_moisture, _geothermal, _crustCollisionIntensity, _crustSuturePairIds,
            _crustSutureStrength, _rockResistance) = NewMaterialStateFields(grid);
        (_mantlePlumeRootStrength, _volcanicActivity, _volcanicConstructionHistory,
            _volcanicLastActiveEpoch) = NewVolcanicFields(grid);
        _slope = NewElevationField(grid);
        _landformCodes = NewField(grid);
        _waterKindCodes = NewField(grid);
        _waterDepths = NewElevationField(grid);
        _waterSurfaceElevations = NewElevationField(grid);
        Array.Fill(_waterSurfaceElevations, long.MinValue);
        _waterBodyIds = NewField(grid);
        (_drainageBasinIds, _flowEdges, _flowAccumulation, _riverOrders) =
            (NewField(grid), NewField(grid), NewField(grid), NewField(grid));
        Array.Fill(_flowEdges, PhysicalGeographyCodes.NoFlowEdge);
        (_riverChannelStrength, _riverChannelOrders, _floodplainIntensity, _deltaIntensity,
            _riverSpineEdgeMasks) =
            (NewField(grid), NewField(grid), NewField(grid), NewField(grid), NewField(grid));
        (_featureFlags, _landmassIds, _landmassClassCodes, _continentalGroupIds,
            _bathymetricZoneCodes) =
            (NewField(grid), NewField(grid), NewField(grid), NewField(grid), NewField(grid));
        (_iceThickness, _iceFlux, _iceFlowTargets, _iceBalance, _groundedIce,
            _maximumGroundedIceFlux) = NewIceFields(grid);
        (_fractureConductance, _heatSourceDensity) = (NewField(grid), NewField(grid));
        (_drainageElevations, _drainageParents, _drainageRanks, _drainageGuidanceTargets,
            _flowTargets, _lakeOutletTargets, _lakeOverflow) = NewDrainageFields(grid);
        _ridgeInfluence = new float[grid.TriangleCount];
        _uplift = new float[grid.TriangleCount];
        _runoff = new int[grid.TriangleCount];
        _warmth = new int[grid.TriangleCount];
    }

    private static int[] NewField(PhysicalGeographyGrid grid) => new int[grid.TriangleCount];

    private static (int[] Moisture, int[] Geothermal, int[] Collision, int[] SuturePair,
        int[] SutureStrength, int[] Resistance) NewMaterialStateFields(PhysicalGeographyGrid grid) =>
        (NewField(grid), NewField(grid), NewField(grid), NewField(grid), NewField(grid), NewField(grid));

    private static (
        int[] ComponentIds,
        int[] Prominence,
        long[] Construction,
        long[] ConvergentSurplus) NewOrogenicFields(
        PhysicalGeographyGrid grid)
    {
        var componentIds = NewField(grid);
        Array.Fill(componentIds, -1);
        return (componentIds, NewField(grid), NewElevationField(grid), NewElevationField(grid));
    }

    private static (int[] Roots, int[] Activity, long[] History, int[] LastActiveEpoch)
        NewVolcanicFields(PhysicalGeographyGrid grid)
    {
        var lastActiveEpoch = NewField(grid);
        Array.Fill(lastActiveEpoch, -1);
        return (NewField(grid), NewField(grid), NewElevationField(grid), lastActiveEpoch);
    }

    private static long[] NewElevationField(PhysicalGeographyGrid grid) => new long[grid.TriangleCount];

    private static (
        long[] Excavation,
        long[] RimUplift,
        long[] Ejecta,
        int[] Heat,
        int[] Meltwater) NewImpactFields(PhysicalGeographyGrid grid) =>
        (NewElevationField(grid), NewElevationField(grid), NewElevationField(grid),
            NewField(grid), NewField(grid));

    private static (
        int[] Thickness,
        int[] Flux,
        int[] Targets,
        int[] Balance,
        int[] Grounded,
        int[] MaximumGroundedFlux) NewIceFields(
        PhysicalGeographyGrid grid)
    {
        var targets = NewField(grid);
        Array.Fill(targets, -1);
        return (NewField(grid), NewField(grid), targets, NewField(grid), NewField(grid), NewField(grid));
    }

    private static (
        long[] Elevations,
        int[] Parents,
        int[] Ranks,
        int[] GuidanceTargets,
        int[] FlowTargets,
        int[] LakeOutlets,
        long[] LakeOverflow) NewDrainageFields(PhysicalGeographyGrid grid)
    {
        var parents = NewField(grid);
        var guidanceTargets = NewField(grid);
        var flowTargets = NewField(grid);
        var lakeOutlets = NewField(grid);
        Array.Fill(parents, -1);
        Array.Fill(guidanceTargets, -1);
        Array.Fill(flowTargets, -1);
        Array.Fill(lakeOutlets, -1);
        return (NewElevationField(grid), parents, NewField(grid), guidanceTargets, flowTargets,
            lakeOutlets, NewElevationField(grid));
    }

    private static (int[] First, int[] Second, int[] Third) NewTriple(
        PhysicalGeographyGrid grid) =>
        (NewField(grid), NewField(grid), NewField(grid));

    private static (
        long[] Bedrock,
        long[] Sediment,
        long[] Supply,
        long[] FluvialErosion,
        long[] GlacialErosion,
        long[] GlacialDeposition,
        long[] CoastalErosion,
        long[] Deposition,
        long[] CrustThickness) NewLandscapeHistoryFields(PhysicalGeographyGrid grid) =>
        (NewElevationField(grid), NewElevationField(grid), NewElevationField(grid),
            NewElevationField(grid), NewElevationField(grid), NewElevationField(grid),
            NewElevationField(grid), NewElevationField(grid), NewElevationField(grid));

    private static (
        long[] Elevation,
        long[] Target,
        long[] SurfaceLoad) NewSupportFields(PhysicalGeographyGrid grid) =>
        (NewElevationField(grid), NewElevationField(grid), NewElevationField(grid));

    private static (
        int[] CurrentX,
        int[] CurrentY,
        int[] CurrentStrength,
        int[] CurrentHeat,
        int[] WaveExposure,
        int[] OceanDistance) NewOceanFields(PhysicalGeographyGrid grid)
    {
        var oceanDistance = NewField(grid);
        Array.Fill(oceanDistance, -1);
        return (
            NewField(grid),
            NewField(grid),
            NewField(grid),
            NewField(grid),
            NewField(grid),
            oceanDistance);
    }

    private static (
        int[] WindX,
        int[] WindY,
        int[] UpwindTargets,
        int[] MoistureBarriers,
        int[] PrecipitationBarriers,
        int[] UpwindOceanSources) NewAtmosphericFields(
        PhysicalGeographyGrid grid)
    {
        var upwindTargets = NewField(grid);
        var upwindOceanSources = NewField(grid);
        Array.Fill(upwindTargets, -1);
        Array.Fill(upwindOceanSources, -1);
        return (
            NewField(grid),
            NewField(grid),
            upwindTargets,
            NewField(grid),
            NewField(grid),
            upwindOceanSources);
    }

    public PhysicalGeographyGrid Grid { get; }

    internal PhysicalGeographyFacts AvailableFacts { get; set; }

    internal long EffectiveSeaLevel { get; set; }

    /// <summary>
    /// Coverage-calibrated datum solved once from the initial tectonic surface.
    /// Epoch sea-level forcing offsets this value; later terrain edits do not
    /// silently retarget ocean coverage.
    /// </summary>
    internal long BaseSeaLevel { get; set; }

    internal bool SeaLevelInitialized { get; set; }

    internal bool CrustSupportInitialized { get; set; }

    public Span<int> CrustBasePotential => _crustBasePotential;

    public Span<int> CrustAssemblyIds => _crustAssemblyIds;

    public Span<int> CrustAssemblySeparation => _crustAssemblySeparation;

    /// <summary>
    /// Per-mille intensity of continent-against-continent collision. Ocean
    /// closing against a continent subducts and builds a coastal range;
    /// continent meeting continent has nowhere to go and stacks crust, which
    /// is what puts a Himalaya deep inside a landmass instead of another
    /// Andes along its shore.
    /// </summary>
    public Span<int> CrustCollisionIntensity => _crustCollisionIntensity;

    /// <summary>
    /// Ordered pair of transported continental assembly IDs welded at this
    /// material suture. Unlike a current province-pair ID, this identity moves
    /// with the crust and remains after the active boundary migrates away.
    /// </summary>
    public Span<int> CrustSuturePairIds => _crustSuturePairIds;

    /// <summary>
    /// Persistent per-mille shortening memory of a continental suture. Active
    /// convergence strengthens it; ordinary advection transports it as crustal
    /// material rather than repainting it from the current province diagram.
    /// </summary>
    public Span<int> CrustSutureStrength => _crustSutureStrength;

    /// <summary>
    /// How hard the rock is, per mille, against a baseline of
    /// <see cref="PhysicalRock.BaselineResistance"/>. Erosion divides by it,
    /// so higher rock wears slower.
    ///
    /// Uniform rock erodes uniformly, which is why undifferentiated terrain
    /// dissects into even roughness with no escarpments, mesas, gorges or
    /// summits that stand clear. Resistance is what holds a landform up.
    /// The engine only knows the number; what raises or lowers it - impact
    /// shock, volcanic rock, and whatever a domain layer contributes - is
    /// written by the layers that own those facts.
    /// </summary>
    public Span<int> RockResistance => _rockResistance;

    public Span<int> CrustMotionX => _crustMotionX;

    public Span<int> CrustMotionY => _crustMotionY;

    public Span<int> CrustProvinceIds => _crustProvinceIds;

    public Span<int> CrustTypeCodes => _crustTypeCodes;

    /// <summary>
    /// Continuous continental composition, per mille. Crust type remains the
    /// categorical classification used by downstream rules; this field owns
    /// the graded physical transition used by thickness and isostasy so the
    /// classification boundary is not also an elevation cliff.
    /// </summary>
    public Span<int> CrustContinentalFraction => _crustContinentalFraction;

    internal Span<int> OceanMarginDistance => _oceanMarginDistance;

    internal Span<int> CoastalMarginCodes => _coastalMarginCodes;

    /// <summary>
    /// What the nearest plate boundary is doing to this crust. Coastal layers
    /// consume this so coasts differ in kind, not merely in raggedness.
    /// </summary>
    /// <summary>
    /// For each triangle, the triangle its crust arrived from during the last
    /// plate-drift step, or -1 where new crust was created at a rift. Published
    /// so domain layers can advect their own persistent history without
    /// Engine.WorldGen knowing what that history is.
    /// </summary>
    public Span<int> AdvectionSourceIndex => _advectionSourceIndex;

    public Span<int> MarginCodes => _marginCodes;

    /// <summary>
    /// Relative crust age in per-mille of the oldest crust, rising away from
    /// spreading boundaries. Oceanic depth follows it, which is what gives
    /// passive margins their broad shallow shelves.
    /// </summary>
    public Span<int> CrustAge => _crustAge;

    internal Span<int> ContinentalPotential => _continentalPotential;

    public Span<int> TectonicBoundaryCodes => _tectonicBoundaryCodes;

    public Span<int> TectonicStrain => _tectonicStrain;

    /// <summary>
    /// Stable ordered pair of province IDs meeting at the current boundary.
    /// Separates distinct plate contacts that touch at a triple junction but
    /// do not share a deformation budget.
    /// </summary>
    public Span<int> TectonicBoundaryPairIds => _tectonicBoundaryPairIds;

    /// <summary>
    /// Canonically oriented tangent to the nearest active plate boundary,
    /// scaled to one thousand. Orogenic relief follows this direction rather
    /// than an unrelated isotropic noise field.
    /// </summary>
    public Span<int> TectonicTangentX => _tectonicTangentX;

    /// <inheritdoc cref="TectonicTangentX"/>
    public Span<int> TectonicTangentY => _tectonicTangentY;

    /// <summary>
    /// Current connected plate-boundary system influencing each triangle, or
    /// -1 outside every active orogen's reach. IDs are rebuilt after each
    /// plate arrangement changes and are meaningful only within that frame.
    /// </summary>
    public Span<int> OrogenicComponentIds => _orogenicComponentIds;

    /// <summary>Assigned connected-system prominence, per mille.</summary>
    public Span<int> OrogenicSystemProminence => _orogenicSystemProminence;

    /// <summary>
    /// Equilibrium-height contribution actually admitted by the crust during
    /// the most recent orogenic construction pass. This is diagnostic state;
    /// persistent relief lives in crustal thickness and activity history.
    /// </summary>
    public Span<long> OrogenicConstruction => _orogenicConstruction;

    /// <summary>
    /// Column-equivalent crustal thickness delivered by convergent overlap in
    /// the most recent advection step. Orogenic construction distributes the
    /// retained share across the plate-pair system instead of turning raster
    /// overlap into a one-cell vertical wall.
    /// </summary>
    public Span<long> ConvergentCrustSurplus => _convergentCrustSurplus;

    internal Span<int> InitialTectonicBoundaryCodes => _initialTectonicBoundaryCodes;

    internal Span<int> InitialTectonicStrain => _initialTectonicStrain;

    public Span<long> Elevation => _elevation;

    public Span<int> Temperature => _temperature;

    internal Span<int> WindX => _windX;

    internal Span<int> WindY => _windY;

    internal Span<int> UpwindTargets => _upwindTargets;

    internal Span<int> MoistureBarriers => _moistureBarriers;

    internal Span<int> PrecipitationBarriers => _precipitationBarriers;

    internal Span<int> UpwindOceanSources => _upwindOceanSources;

    public Span<int> Moisture => _moisture;

    public Span<int> OceanCurrentX => _oceanCurrentX;

    public Span<int> OceanCurrentY => _oceanCurrentY;

    public Span<int> OceanCurrentStrength => _oceanCurrentStrength;

    public Span<int> OceanCurrentHeat => _oceanCurrentHeat;

    internal Span<int> OceanDistance => _oceanDistance;

    public Span<int> WaveExposure => _waveExposure;

    public Span<int> Rainfall => _rainfall;

    public Span<int> Snowfall => _snowfall;

    public Span<int> SeaIceSuitability => _seaIceSuitability;

    public Span<long> BedrockElevation => _bedrockElevation;

    /// <summary>
    /// Crustal thickness, in the same fixed-point units as elevation. This is
    /// the quantity plate tectonics changes: collision thickens it and rifting
    /// thins it. Surface loading and erosion remain separate from the crustal
    /// column. Surface height is
    /// derived from it by isostasy rather than painted from a continental
    /// mask, because a mask must saturate to define "definitely land" and so
    /// flattens exactly the interior it defines. Thickness has no such
    /// ceiling - two collisions stack where one collided once.
    /// </summary>
    public Span<long> CrustThickness => _crustThickness;

    /// <summary>
    /// Flexed equilibrium datum currently supporting the bedrock surface.
    /// Bedrock retains local relief relative to this datum while regional
    /// isostasy changes the datum itself.
    /// </summary>
    public Span<long> CrustSupportElevation => _crustSupportElevation;

    /// <summary>Local Airy/load target awaiting regional flexure.</summary>
    internal Span<long> CrustSupportTarget => _crustSupportTarget;

    /// <summary>
    /// Signed bedrock load added above or removed below the initialized
    /// surface. Volcanism and impact rims add load; erosion and excavation
    /// unload it. Sediment and ice are tracked independently.
    /// </summary>
    public Span<long> SurfaceRockLoad => _surfaceRockLoad;

    public Span<long> SedimentThickness => _sedimentThickness;

    public Span<long> SedimentSupply => _sedimentSupply;

    public Span<long> CumulativeFluvialErosion => _cumulativeFluvialErosion;

    public Span<long> CumulativeGlacialErosion => _cumulativeGlacialErosion;

    public Span<long> CumulativeGlacialDeposition => _cumulativeGlacialDeposition;

    public Span<long> CumulativeCoastalErosion => _cumulativeCoastalErosion;

    public Span<long> CumulativeDeposition => _cumulativeDeposition;

    public Span<int> MaximumIceThickness => _maximumIceThickness;

    public Span<int> MaximumIceFlux => _maximumIceFlux;

    public Span<int> MaximumGroundedIceFlux => _maximumGroundedIceFlux;

    public Span<int> TectonicActivityHistory => _tectonicActivityHistory;

    public Span<int> WaveExposureHistory => _waveExposureHistory;

    public Span<int> GeothermalHistory => _geothermalHistory;

    public Span<long> ImpactExcavation => _impactExcavation;

    public Span<long> ImpactRimUplift => _impactRimUplift;

    public Span<long> ImpactEjectaThickness => _impactEjectaThickness;

    public Span<int> ImpactHeat => _impactHeat;

    public Span<int> GlacialMeltwater => _glacialMeltwater;

    public Span<int> ExternalHeatForcing => _externalHeatForcing;

    public Span<int> ExternalCoastalForcing => _externalCoastalForcing;

    public Span<int> ExternalCoastalForcingHistory => _externalCoastalForcingHistory;

    public Span<int> Geothermal => _geothermal;

    public Span<long> Slope => _slope;

    public Span<int> LandformCodes => _landformCodes;

    public Span<int> WaterKindCodes => _waterKindCodes;

    public ReadOnlySpan<long> WaterDepths => _waterDepths;

    public ReadOnlySpan<long> WaterSurfaceElevations => _waterSurfaceElevations;

    internal Span<long> MutableWaterDepths => _waterDepths;

    public Span<int> WaterBodyIds => _waterBodyIds;

    public Span<int> DrainageBasinIds => _drainageBasinIds;

    public Span<int> FlowEdges => _flowEdges;

    public Span<int> FlowAccumulation => _flowAccumulation;

    public Span<int> RiverOrders => _riverOrders;

    public Span<int> RiverChannelStrength => _riverChannelStrength;

    public Span<int> RiverChannelOrders => _riverChannelOrders;

    public Span<int> FloodplainIntensity => _floodplainIntensity;

    public Span<int> DeltaIntensity => _deltaIntensity;

    public Span<int> RiverSpineEdgeMasks => _riverSpineEdgeMasks;

    public Span<int> FeatureFlags => _featureFlags;

    public Span<int> LandmassIds => _landmassIds;

    public Span<int> LandmassClassCodes => _landmassClassCodes;

    public Span<int> ContinentalGroupIds => _continentalGroupIds;

    public Span<int> BathymetricZoneCodes => _bathymetricZoneCodes;

    public Span<int> IceThickness => _iceThickness;

    public Span<int> IceFlux => _iceFlux;

    public Span<int> GroundedIce => _groundedIce;

    internal Span<int> IceFlowTargets => _iceFlowTargets;

    internal Span<int> IceBalance => _iceBalance;

    public Span<int> FractureConductance => _fractureConductance;

    public Span<int> HeatSourceDensity => _heatSourceDensity;

    public Span<int> MantlePlumeRootStrength => _mantlePlumeRootStrength;

    public Span<int> VolcanicActivity => _volcanicActivity;

    public Span<long> VolcanicConstructionHistory => _volcanicConstructionHistory;

    public Span<int> VolcanicLastActiveEpoch => _volcanicLastActiveEpoch;

    internal Span<long> DrainageElevations => _drainageElevations;

    public ReadOnlySpan<long> ConditionedDrainageElevation => _drainageElevations;

    internal Span<int> DrainageParents => _drainageParents;

    internal Span<int> DrainageRanks => _drainageRanks;

    public ReadOnlySpan<int> DrainageFlatRanks => _drainageRanks;

    internal Span<int> DrainageGuidanceTargets => _drainageGuidanceTargets;

    internal Span<int> FlowTargets => _flowTargets;

    internal Span<int> LakeOutletTargets => _lakeOutletTargets;

    /// <summary>
    /// Water-budget surplus delivered through a spilling lake outlet during
    /// the current drainage reconciliation. Stored only on the lake member
    /// owning <see cref="LakeOutletTargets"/>.
    /// </summary>
    public Span<long> LakeOverflow => _lakeOverflow;

    public Span<float> RidgeInfluence => _ridgeInfluence;

    public Span<float> Uplift => _uplift;

    internal Span<int> Runoff => _runoff;

    internal Span<int> Warmth => _warmth;

    internal void ClearWaterSurfaces()
    {
        _waterDepths.AsSpan().Clear();
        Array.Fill(_waterSurfaceElevations, long.MinValue);
    }

    internal void ClearWaterSurface(int triangleIndex)
    {
        _waterDepths[triangleIndex] = 0;
        _waterSurfaceElevations[triangleIndex] = long.MinValue;
    }

    internal void SetWaterSurface(int triangleIndex, long surfaceElevation)
    {
        var depth = surfaceElevation - _elevation[triangleIndex];
        if (depth <= 0)
        {
            throw new InvalidOperationException("Water surface must be above its physical floor.");
        }

        _waterSurfaceElevations[triangleIndex] = surfaceElevation;
        _waterDepths[triangleIndex] = depth;
    }

    internal void ReconcileWaterAfterFloorChange(int triangleIndex)
    {
        var surface = _waterSurfaceElevations[triangleIndex];
        if (surface == long.MinValue)
        {
            return;
        }

        if (surface > _elevation[triangleIndex])
        {
            _waterDepths[triangleIndex] = surface - _elevation[triangleIndex];
            return;
        }

        _waterKindCodes[triangleIndex] = PhysicalWaterKindCodes.None;
        _waterBodyIds[triangleIndex] = 0;
        _lakeOutletTargets[triangleIndex] = -1;
        _lakeOverflow[triangleIndex] = 0;
        ClearWaterSurface(triangleIndex);
    }

    internal long SedimentProducedTotal { get; set; }

    internal long SedimentDepositedTotal { get; set; }

    internal long SedimentExportedTotal { get; set; }

    public int CompletedEpochCount { get; internal set; }

    /// <summary>
    /// Total distance, in world units, that plates have drifted since world
    /// creation. Province sites are placed at their seed positions offset by
    /// this, so each epoch is a static snapshot of a moved plate arrangement.
    /// </summary>
    public double AccumulatedPlateDrift { get; internal set; }

    /// <summary>
    /// Metric distance transported at the latest epoch boundary. Persistent
    /// oceanic material uses it to age after advection; newly opened crust is
    /// left at age zero.
    /// </summary>
    public double LastPlateDriftStep { get; internal set; }

    /// <summary>
    /// Cumulative drainage-guidance selections whose top candidate scores tied
    /// within epsilon, leaving the hashed tie-break to decide. With real
    /// relief everywhere this should stay near zero of
    /// <see cref="DrainageDecisionTotal"/>.
    /// </summary>
    public long DrainageTieDecisionTotal { get; internal set; }

    public long DrainageDecisionTotal { get; internal set; }

    /// <summary>
    /// Cumulative priority-flood fills where the neighbor floor sat at or
    /// below the flood level (flat or depression fill), against all fills.
    /// </summary>
    public long FloodFlatFillTotal { get; internal set; }

    public long FloodFillTotal { get; internal set; }
}
