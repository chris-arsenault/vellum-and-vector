namespace Engine.WorldGen;

/// <summary>
/// Discrete geography identified on the generated microtriangle field before
/// any runtime-map projection is chosen.
/// </summary>
public sealed class PhysicalGeologicalFeatureMap
{
    private readonly Dictionary<int, PhysicalGeologicalFeature> _features = [];
    private readonly Dictionary<int, int[]> _triangleIndexesByFeature = [];

    public IReadOnlyDictionary<int, PhysicalGeologicalFeature> Features => _features;

    public void Add(PhysicalGeologicalFeature feature, IReadOnlyCollection<int> triangleIndexes)
    {
        ArgumentNullException.ThrowIfNull(feature);
        ArgumentNullException.ThrowIfNull(triangleIndexes);
        _features[feature.Id] = feature;
        _triangleIndexesByFeature[feature.Id] = triangleIndexes.Order().ToArray();
    }

    public IReadOnlyList<int> TriangleIndexes(int featureId) =>
        _triangleIndexesByFeature.TryGetValue(featureId, out var indexes) ? indexes : [];
}

public sealed record PhysicalGeologicalFeature(
    int Id,
    PhysicalGeologicalFeatureKind Kind,
    int AnchorTriangleIndex,
    int Magnitude,
    int TriangleCount);

public enum PhysicalGeologicalFeatureKind
{
    RiverSystem,
    Lake,
    Range,
    Peak,
    Waterfall,
    Crater,
    Plain,
}
