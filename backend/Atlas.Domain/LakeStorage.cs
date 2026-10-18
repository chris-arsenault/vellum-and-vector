namespace Atlas.Domain;

public static class LakeStorage
{
    public static WaterBodyState? FromFeature(Feature feature)
    {
        if (feature.Kind != "lake" || feature.Attributes["hypsometry"] is not System.Text.Json.Nodes.JsonArray curve) return null;
        var values = feature.Attributes;
        return new(feature.Id, feature.Geometry, curve.Select(v => AtlasJson.Read<LakeSlice>(v!)).ToList(),
            values["storage"]!.GetValue<double>(), values["spillElevation"]!.GetValue<double>(),
            values["outlet"] is { } outlet ? AtlasJson.Read<Position>(outlet) : null,
            values["outletFrom"] is { } from ? AtlasJson.Read<Position>(from) : null,
            values["suspendedSediment"]?.GetValue<double>() ?? 0,
            OutletPath: values["outletPath"] is { } path ? AtlasJson.Read<List<Position>>(path) : null);
    }
    public sealed class Index
    {
        private readonly NetTopologySuite.Index.Strtree.STRtree<(WaterBodyState Body, LakeSlice Slice, NetTopologySuite.Geometries.Geometry Shape)> tree = new();
        private readonly Dictionary<Guid, double> levels;
        public IReadOnlyList<WaterBodyState> Bodies { get; }
        public int Count { get; }
        public Index(IReadOnlyList<WaterBodyState> bodies)
        {
            Bodies = bodies; Count = bodies.Count;
            levels = bodies.ToDictionary(b => b.Id, Level);
            foreach (var body in bodies)
                foreach (var slice in body.Slices.Where(s => s.Footprint is not null))
                {
                    var shape = Spatial.Read(slice.Footprint!);
                    tree.Insert(shape.EnvelopeInternal, (body, slice, shape));
                }
        }
        public double? Sample(string field, Position point)
        {
            var geometry = Spatial.Point(point);
            foreach (var (body, slice, shape) in tree.Query(geometry.EnvelopeInternal))
            {
                if (!shape.Covers(geometry)) continue;
                if (field == "elevation") return slice.Floor;
                if (field == "sediment") return slice.Sediment;
                if (field == "bedrock") return slice.Floor - slice.Sediment;
                var level = levels[body.Id]; var depth = Math.Max(0, level - slice.Floor);
                return field == "waterSurface" ? Math.Max(level, slice.Floor) : field == "water" ? depth > 0 ? 2 : 0 : depth;
            }
            return null;
        }
        public IEnumerable<(WaterBodyState Body, LakeSlice Slice, NetTopologySuite.Geometries.Geometry Shape)> Overlaps(NetTopologySuite.Geometries.Geometry support) =>
            tree.Query(support.EnvelopeInternal).Where(s => s.Shape.Intersects(support));
    }
    public static double? Sample(ref Index? index, IReadOnlyList<WaterBodyState>? bodies, string field, Position point)
    {
        if (bodies is null || bodies.Count == 0 || field is not ("elevation" or "bedrock" or "sediment" or "waterSurface" or "waterDepth" or "surfaceStorage" or "water")) return null;
        if (index is null || !ReferenceEquals(index.Bodies, bodies) || index.Count != bodies.Count) index = new(bodies);
        return index.Sample(field, point);
    }
    public static Index? GetIndex(ref Index? index, IReadOnlyList<WaterBodyState>? bodies)
    {
        if (bodies is null || bodies.Count == 0) return null;
        if (index is null || !ReferenceEquals(index.Bodies, bodies) || index.Count != bodies.Count) index = new(bodies);
        return index;
    }
    public static double Capacity(WaterBodyState state, double level) => state.Slices.Sum(s => s.Area * Math.Max(0, level - s.Floor));
    public static double Level(WaterBodyState state)
    {
        if (state.FixedLevel is { } fixedLevel) return fixedLevel;
        var lo = state.Slices.Min(s => s.Floor);
        if (state.Volume <= 0) return lo;
        var hi = Math.Max(state.Spill, lo) + state.Volume / state.Slices.Sum(s => s.Area);
        for (var i = 0; i < 60; i++)
        {
            var mid = (lo + hi) / 2;
            if (Capacity(state, mid) > state.Volume) hi = mid; else lo = mid;
        }
        return (lo + hi) / 2;
    }

}
