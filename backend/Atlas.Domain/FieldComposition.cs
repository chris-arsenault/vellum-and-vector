namespace Atlas.Domain;

public static class FieldComposition
{
    public static FieldData Resample(FieldData source, Area area, int resolution)
    {
        var result = new FieldData(Guid.NewGuid(), area.Id, Spatial.Bounds(area.Footprint), resolution, resolution,
            source.Values.Keys.ToDictionary(k => k, _ => new double[resolution * resolution]), source.Algorithm, source.Seed,
            History: source.History, Initial: source.Initial, WaterBodies: source.WaterBodies);
        for (var y = 0; y < resolution; y++)
            for (var x = 0; x < resolution; x++)
                foreach (var key in result.Values.Keys) result.Values[key][y * resolution + x] = source.Sample(key, result.PositionAt(x, y));
        return result;
    }
    public static System.Text.Json.Nodes.JsonObject Coverage(World world, FieldData field, string channel) => Spatial.Write(CoverageGeometry(world, field, channel));
    public static NetTopologySuite.Geometries.Geometry CoverageGeometry(World world, FieldData field, string channel)
    {
        var area = world.Areas[field.AreaId];
        var shape = Spatial.Read(area.Footprint);
        var ownIndex = world.Fields.FindIndex(f => f.Id == field.Id);
        foreach (var other in world.Fields.Where(f => f.Id != field.Id && f.Channels?.Contains(channel) == true &&
            Composition.Space(world, f.AreaId) == Composition.Space(world, field.AreaId)))
        {
            var otherArea = world.Areas[other.AreaId];
            if (otherArea.Profile > area.Profile || otherArea.Profile == area.Profile && world.Fields.FindIndex(f => f.Id == other.Id) > ownIndex)
                shape = shape.Difference(Spatial.Read(otherArea.Footprint));
        }
        return shape;
    }
    public static FieldData? At(World world, IReadOnlyList<FieldData> fields, Guid areaId, string channel, Position point) =>
        fields.Where(f => f.Values.ContainsKey(channel) && Composition.Space(world, f.AreaId) == Composition.Space(world, areaId) &&
            Spatial.Read(world.Areas[f.AreaId].Footprint).Covers(Spatial.Point(point)))
            .OrderBy(f => world.Areas[f.AreaId].Profile).LastOrDefault();

    public static double Sample(World world, IReadOnlyList<FieldData> fields, Guid areaId, string channel, Position point) =>
        At(world, fields, areaId, channel, point)?.Sample(channel, point) ?? 0;
}
