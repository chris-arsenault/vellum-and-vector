using Atlas.Domain;
using NetTopologySuite.Geometries;
using Npgsql;
using System.Text.Json;
using System.Text.Json.Nodes;
using static Atlas.Persistence.Sql;
using Position = Atlas.Domain.Position;

namespace Atlas.Persistence;

public sealed partial class Store
{
    private static async Task ReadDomainAttributes(NpgsqlConnection c, Dictionary<Guid, JsonObject> result, Guid[] ids)
    {
        var stations = await Sql.Read(c, "SELECT * FROM atlas_stations WHERE revision_id=ANY($1) ORDER BY channel,part,station", r =>
            (Revision: RevisionId(r), Channel: Value<string>(r, "channel"), Number: Value<double>(r, "value")), ids);
        foreach (var group in stations.GroupBy(v => (v.Revision, v.Channel)))
            result[group.Key.Revision][group.Key.Channel] = new JsonArray(group.Select(v => (JsonNode?)JsonValue.Create(v.Number)).ToArray());
        var points = await Sql.Read(c, "SELECT * FROM atlas_feature_positions WHERE revision_id=ANY($1) ORDER BY ordinal", r =>
            (Revision: RevisionId(r), Role: Value<string>(r, "role"), Point: Value<Position>(r, "point")), ids);
        foreach (var group in points.GroupBy(v => (v.Revision, v.Role)))
            result[group.Key.Revision][group.Key.Role] = group.Key.Role == "outletPath" ? JsonSerializer.SerializeToNode(group.Select(v => v.Point), AtlasJson.Options) : JsonSerializer.SerializeToNode(group.First().Point, AtlasJson.Options);
        var slices = await Sql.Read(c, "SELECT * FROM atlas_hypsometry WHERE revision_id=ANY($1) ORDER BY ordinal", r =>
            (Revision: RevisionId(r), Slice: new LakeSlice(Value<double>(r, "floor"), Value<double>(r, "area"),
                Optional<Geometry>(r, "footprint") is { } shape ? Spatial.Write(shape) : null, Value<double>(r, "sediment"))), ids);
        foreach (var group in slices.GroupBy(v => v.Revision)) result[group.Key]["hypsometry"] = JsonSerializer.SerializeToNode(group.Select(v => v.Slice), AtlasJson.Options);
        var events = await Sql.Read(c, "SELECT * FROM atlas_construction_events WHERE revision_id=ANY($1) ORDER BY ordinal", r =>
        {
            var value = new JsonObject();
            foreach (var key in new[] { "era", "action", "cause" }) if (Optional<string>(r, key) is { } text) value[key] = text;
            if (Optional<double?>(r, "depth") is { } depth) value["depth"] = depth;
            return (Revision: RevisionId(r), Event: value);
        }, ids);
        foreach (var group in events.GroupBy(v => v.Revision)) result[group.Key]["history"] = new JsonArray(group.Select(v => (JsonNode?)v.Event).ToArray());
        var caveStations = await Sql.Read(c, "SELECT revision_id,station FROM atlas_cave_stations WHERE revision_id=ANY($1) ORDER BY station", r => (Revision: r.GetGuid(0), Station: r.GetInt32(1)), ids);
        foreach (var group in caveStations.GroupBy(v => v.Revision)) result[group.Key]["epochHistory"] = new JsonArray(group.Select(_ => (JsonNode?)new JsonArray()).ToArray());
        var cave = await Sql.Read(c, "SELECT * FROM atlas_cave_events WHERE revision_id=ANY($1) ORDER BY station,ordinal", r =>
            (Revision: RevisionId(r), Station: Value<int>(r, "station"), Event: new JsonObject
            {
                ["epoch"] = Value<string>(r, "epoch"), ["dissolution"] = Value<double>(r, "dissolution"), ["collapse"] = Value<double>(r, "collapse"),
                ["deposition"] = Value<double>(r, "deposition"), ["iceDamage"] = Value<double>(r, "ice_damage")
            }), ids);
        foreach (var group in cave.GroupBy(v => (v.Revision, v.Station))) result[group.Key.Revision]["epochHistory"]![group.Key.Station] = new JsonArray(group.Select(v => (JsonNode?)v.Event).ToArray());
        var exchanges = await Sql.Read(c, "SELECT * FROM atlas_water_exchange WHERE revision_id=ANY($1)", r =>
            (Revision: RevisionId(r), Value: new JsonObject { ["mechanism"] = Value<string>(r, "mechanism"), ["volume"] = Value<double>(r, "volume"), ["years"] = Value<double>(r, "years") }), ids);
        foreach (var row in exchanges) result[row.Revision]["waterExchange"] = row.Value;
        var shapes = await Sql.Read(c, "SELECT * FROM atlas_attribute_shapes WHERE revision_id=ANY($1) ORDER BY cardinality(path)", r =>
            (Revision: RevisionId(r), Name: Value<string>(r, "attribute"), Path: Value<int[]>(r, "path"), Properties: Value<string[]>(r, "properties"), Nulls: Value<string[]>(r, "null_properties")), ids);
        foreach (var shape in shapes)
        {
            JsonNode node = result[shape.Revision][shape.Name]!;
            foreach (var index in shape.Path) node = node[index]!;
            var obj = node.AsObject();
            foreach (var key in obj.Select(p => p.Key).Except(shape.Properties).ToList()) obj.Remove(key);
            foreach (var key in shape.Nulls) obj[key] = null;
        }
    }
}
