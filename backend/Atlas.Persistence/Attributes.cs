using Atlas.Domain;
using Npgsql;
using System.Text.Json;
using System.Text.Json.Nodes;
using static Atlas.Persistence.Sql;

namespace Atlas.Persistence;

public sealed partial class Store
{
    private static readonly string[] StationChannels = ["elevations", "discharges", "junctionInflows", "widths", "floorElevations", "floodDepths"];

    private static async Task WriteAttributes(NpgsqlConnection c, Guid revision, JsonObject attributes, bool domain, JsonObject? geometry = null)
    {
        var ordinal = 0;
        await Node([], new JsonObject(), false);
        foreach (var (name, value) in attributes)
        {
            if (domain && DomainShape(name, value) && await WriteDomainAttribute(c, revision, name, value, geometry))
            {
                await ObjectShape(name, value, []);
                await Node([name], value is JsonArray ? new JsonArray() : value is JsonObject ? new JsonObject() : null, false);
            }
            else await Node([name], value, true);
        }

        async Task ObjectShape(string name, JsonNode? node, int[] path)
        {
            if (node is JsonObject obj) await Insert(c, "atlas_attribute_shapes", [("revision_id", revision), ("attribute", name), ("path", path),
                ("properties", obj.Select(p => p.Key).ToArray()), ("null_properties", obj.Where(p => p.Value is null).Select(p => p.Key).ToArray())]);
            if (node is JsonArray array) for (var i = 0; i < array.Count; i++) await ObjectShape(name, array[i], [.. path, i]);
        }

        async Task Node(string[] path, JsonNode? node, bool children)
        {
            var kind = node switch
            {
                JsonObject => "object", JsonArray => "array", null => "null",
                _ => node.GetValueKind() switch { JsonValueKind.String => "text", JsonValueKind.Number => "number", JsonValueKind.True or JsonValueKind.False => "boolean", _ => "null" }
            };
            await Execute(c, "INSERT INTO atlas_attributes(revision_id,path,ordinal,kind,text_value,number_value,bool_value) VALUES($1,$2,$3,$4,$5,$6::text::numeric,$7)",
                revision, path, ordinal++, kind, Text(kind == "text" ? node!.GetValue<string>() : null), Text(kind == "number" ? node!.ToJsonString() : null),
                Null(kind == "boolean" ? node!.GetValue<bool>() : (bool?)null, "bool"));
            if (!children) return;
            if (node is JsonObject obj) foreach (var (key, value) in obj) await Node([.. path, key], value, true);
            if (node is JsonArray array) for (var i = 0; i < array.Count; i++) await Node([.. path, i.ToString(System.Globalization.CultureInfo.InvariantCulture)], array[i], true);
        }
    }

    private static bool DomainShape(string name, JsonNode? node)
    {
        static bool Numeric(JsonNode? n) => n?.GetValueKind() == JsonValueKind.Number;
        static bool Point(JsonNode? n) => n is JsonObject p && Numeric(p["x"]) && Numeric(p["y"]) &&
            (!p.ContainsKey("z") || Numeric(p["z"])) && p.All(v => v.Key is "x" or "y" or "z");
        static bool Event(JsonNode? n) => n is JsonObject e && e.All(p => p.Key switch
        {
            "era" or "action" or "cause" => p.Value is null || p.Value.GetValueKind() == JsonValueKind.String,
            "depth" => p.Value is null || Numeric(p.Value), _ => false
        });
        if (StationChannels.Contains(name)) return node is JsonArray numbers && numbers.All(Numeric);
        return name switch
        {
            "center" or "outlet" or "outletFrom" => Point(node),
            "outletPath" => node is JsonArray path && path.All(Point),
            "history" => node is JsonArray events && events.All(Event),
            "hypsometry" => node is JsonArray slices && slices.All(n => n is JsonObject s && Numeric(s["floor"]) && Numeric(s["area"]) &&
                (!s.ContainsKey("sediment") || Numeric(s["sediment"])) && (!s.ContainsKey("footprint") || s["footprint"] is null or JsonObject) &&
                s.All(p => p.Key is "floor" or "area" or "sediment" or "footprint")),
            "epochHistory" => node is JsonArray stations && stations.All(n => n is JsonArray events && events.All(e => e is JsonObject o && o.Count == 5 &&
                o["epoch"]?.GetValueKind() == JsonValueKind.String && new[] { "dissolution", "collapse", "deposition", "iceDamage" }.All(k => Numeric(o[k])))),
            "waterExchange" => node is JsonObject exchange && exchange.Count == 3 && exchange["mechanism"]?.GetValueKind() == JsonValueKind.String && Numeric(exchange["volume"]) && Numeric(exchange["years"]),
            _ => false
        };
    }

    private static async Task<bool> WriteDomainAttribute(NpgsqlConnection c, Guid revision, string name, JsonNode? node, JsonObject? geometry)
    {
        if (node is null) return false;
        if (StationChannels.Contains(name) && node is JsonArray series && series.All(v => v?.GetValueKind() == JsonValueKind.Number))
        {
            var parts = geometry is null ? [] : Composition.Parts(Spatial.Read(geometry)).Select(g => g.Coordinates.Length).ToArray();
            var part = 0; var station = 0;
            for (var i = 0; i < series.Count; i++)
            {
                if (parts.Sum() == series.Count && station == parts[part]) { part++; station = 0; }
                await Insert(c, "atlas_stations", [("revision_id", revision), ("channel", name), ("part", part), ("station", station++), ("value", AtlasJson.Read<double>(series[i]!))]);
            }
            return true;
        }
        if (name is "center" or "outlet" or "outletFrom" && node is JsonObject point && point.All(v => v.Key is "x" or "y" or "z"))
        {
            await Insert(c, "atlas_feature_positions", [("revision_id", revision), ("role", name), ("ordinal", 0), ("point", AtlasJson.Read<Position>(point))]);
            return true;
        }
        if (name == "outletPath" && node is JsonArray path)
        {
            for (var i = 0; i < path.Count; i++) await Insert(c, "atlas_feature_positions", [("revision_id", revision), ("role", name), ("ordinal", i), ("point", AtlasJson.Read<Position>(path[i]!))]);
            return true;
        }
        if (name == "hypsometry" && node is JsonArray slices)
        {
            for (var i = 0; i < slices.Count; i++)
            {
                var v = AtlasJson.Read<LakeSlice>(slices[i]!);
                await Insert(c, "atlas_hypsometry", [("revision_id", revision), ("ordinal", i), ("floor", v.Floor), ("area", v.Area),
                    ("footprint", Null(v.Footprint is null ? null : Spatial.Read(v.Footprint), "geometry")), ("sediment", v.Sediment)]);
            }
            return true;
        }
        // Histories are typed, while optional-property presence is retained by
        // the attribute shape. Unknown custom structures remain GIS attributes.
        if (name == "history" && node is JsonArray events && events.All(v => v is JsonObject o && o.All(p => p.Key is "era" or "action" or "cause" or "depth")))
        {
            for (var i = 0; i < events.Count; i++)
            {
                var e = events[i]!;
                await Insert(c, "atlas_construction_events", [("revision_id", revision), ("ordinal", i), ("era", Text(e["era"]?.GetValue<string>())),
                    ("action", Text(e["action"]?.GetValue<string>())), ("cause", Text(e["cause"]?.GetValue<string>())), ("depth", Number(e["depth"] is { } depth ? AtlasJson.Read<double>(depth) : null))]);
            }
            return true;
        }
        if (name == "epochHistory" && node is JsonArray stations)
        {
            for (var station = 0; station < stations.Count; station++)
            {
                await Insert(c, "atlas_cave_stations", [("revision_id", revision), ("station", station)]);
                for (var i = 0; i < stations[station]!.AsArray().Count; i++)
                {
                    var e = stations[station]![i]!;
                    await Insert(c, "atlas_cave_events", [("revision_id", revision), ("station", station), ("ordinal", i), ("epoch", e["epoch"]!.GetValue<string>()),
                        ("dissolution", AtlasJson.Read<double>(e["dissolution"]!)), ("collapse", AtlasJson.Read<double>(e["collapse"]!)),
                        ("deposition", AtlasJson.Read<double>(e["deposition"]!)), ("ice_damage", AtlasJson.Read<double>(e["iceDamage"]!))]);
                }
            }
            return true;
        }
        if (name == "waterExchange" && node is JsonObject exchange)
        {
            await Insert(c, "atlas_water_exchange", [("revision_id", revision), ("mechanism", exchange["mechanism"]!.GetValue<string>()),
                ("volume", AtlasJson.Read<double>(exchange["volume"]!)), ("years", AtlasJson.Read<double>(exchange["years"]!))]);
            return true;
        }
        return false;
    }

    private static async Task<Dictionary<Guid, JsonObject>> ReadAttributes(NpgsqlConnection c, IEnumerable<Guid> revisions)
    {
        var result = revisions.Distinct().ToDictionary(v => v, _ => new JsonObject());
        var ids = result.Keys.ToArray();
        var rows = await Sql.Read(c, "SELECT *,number_value::text AS number_text FROM atlas_attributes WHERE revision_id=ANY($1) ORDER BY cardinality(path),ordinal", r =>
            (Revision: RevisionId(r), Path: Value<string[]>(r, "path"), Node: Value<string>(r, "kind") switch
            {
                "object" => (JsonNode?)new JsonObject(), "array" => new JsonArray(), "text" => JsonValue.Create(Value<string>(r, "text_value")),
                "number" => JsonNode.Parse(Value<string>(r, "number_text")), "boolean" => JsonValue.Create(Value<bool>(r, "bool_value")), _ => null
            }), ids);
        foreach (var row in rows)
        {
            if (row.Path.Length == 0) continue;
            JsonNode parent = result[row.Revision];
            foreach (var key in row.Path.SkipLast(1)) parent = parent is JsonArray a ? a[int.Parse(key, System.Globalization.CultureInfo.InvariantCulture)]! : parent[key]!;
            if (parent is JsonArray array)
            {
                var index = int.Parse(row.Path[^1], System.Globalization.CultureInfo.InvariantCulture);
                while (array.Count <= index) array.Add(null);
                array[index] = row.Node;
            }
            else parent[row.Path[^1]] = row.Node;
        }
        await ReadDomainAttributes(c, result, ids);
        return result;
    }
}
