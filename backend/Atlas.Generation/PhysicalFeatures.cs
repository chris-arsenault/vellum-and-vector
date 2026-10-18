using Atlas.Domain;
using Engine.WorldGen;
using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.Union;
using System.Text.Json.Nodes;
using Position = Atlas.Domain.Position;

namespace Atlas.Generation;

public static class PhysicalFeatures
{
    public static List<Feature> WaterFeatures(PhysicalGeographyField map, GenerationInput input, Guid jobId, Func<int, Position> locate, double scale)
    {
        var area = input.World.Areas[input.Request.AreaId];
        var shape = Spatial.Read(area.Footprint);
        var result = new List<Feature>();
        var bodies = Enumerable.Range(0, map.Grid.TriangleCount).Where(i => map.WaterKindCodes[i] != 0 && shape.Covers(Spatial.Point(locate(i))))
            .GroupBy(i => map.WaterBodyIds[i]);
        foreach (var body in bodies)
        {
            var kind = map.WaterKindCodes[body.First()] == 1 ? "ocean" : "lake";
            var anchor = body.Min();
            var cells = body.Select(i => (Index: i, Geometry: Triangle(map, i, locate(i), scale).Intersection(shape))).Where(c => c.Geometry.Area > 0).ToList();
            var geometry = UnaryUnionOp.Union(cells.Select(c => c.Geometry).ToList());
            if (geometry.IsEmpty || geometry.Area == 0) continue;
            var feature = HumanGeography.Generated(input.World, area, jobId, kind == "ocean" ? "Connected ocean" : $"Lake {body.Key}", kind, "lakes", Spatial.Write(geometry),
                kind == "ocean" ? "waterbody:ocean" : $"waterbody:lake:{map.Grid.TriangleIdentity(anchor)}", new()
                {
                    ["waterLevel"] = (map.WaterSurfaceElevations[anchor] - map.BaseSeaLevel) / 1024d,
                    ["storage"] = cells.Sum(c => map.WaterDepths[c.Index] / 1024d * c.Geometry.Area),
                    ["storageUnits"] = "m3",
                    ["body"] = body.Key
                });
            if (kind == "lake")
            {
                feature.Attributes["hypsometry"] = new JsonArray(cells.GroupBy(c => map.Elevation[c.Index]).OrderBy(g => g.Key)
                    .Select(g => (JsonNode?)new JsonObject
                    {
                        ["floor"] = (g.Key - map.BaseSeaLevel) / 1024d,
                        ["area"] = g.Sum(c => c.Geometry.Area),
                        ["sediment"] = g.Sum(c => map.SedimentThickness[c.Index] / 1024d * c.Geometry.Area) / g.Sum(c => c.Geometry.Area),
                        ["footprint"] = Spatial.Write(UnaryUnionOp.Union(g.Select(c => c.Geometry).ToList()))
                    }).ToArray());
                feature.Attributes["spillElevation"] = (body.Min(i => map.DrainageElevations[i]) - map.BaseSeaLevel) / 1024d;
                var outlet = body.FirstOrDefault(i => map.LakeOutletTargets[i] >= 0, -1);
                if (outlet < 0) outlet = body.MinBy(i => map.DrainageRanks[i]);
                if (outlet >= 0)
                {
                    var target = map.LakeOutletTargets[outlet] >= 0 ? map.LakeOutletTargets[outlet] : map.DrainageParents[outlet];
                    if (target < 0) target = outlet;
                    feature.Attributes["outlet"] = System.Text.Json.JsonSerializer.SerializeToNode(locate(target), AtlasJson.Options);
                    feature.Attributes["outletFrom"] = System.Text.Json.JsonSerializer.SerializeToNode(locate(outlet), AtlasJson.Options);
                    var path = new List<Position> { locate(outlet) }; var visited = new HashSet<int> { outlet };
                    while (target >= 0 && visited.Add(target))
                    {
                        path.Add(locate(target));
                        if (map.WaterKindCodes[target] != 0 && map.WaterBodyIds[target] != body.Key || !shape.Covers(Spatial.Point(locate(target)))) break;
                        target = map.DrainageParents[target];
                    }
                    feature.Attributes["outletPath"] = System.Text.Json.JsonSerializer.SerializeToNode(path, AtlasJson.Options);
                }
            }
            result.Add(feature);
        }
        return result;
    }

    public static List<Feature> FromCanonry(PhysicalGeographyField map, GenerationInput input, Guid jobId, Func<int, Position> locate, double scale)
    {
        var area = input.World.Areas[input.Request.AreaId];
        var shape = Spatial.Read(area.Footprint);
        var dischargeScale = 1.2990381057 * scale * scale * .001 / RegionalGrid.SecondsPerYear;
        const double minimumBankfullWidth = 1;
        var minimumDischarge = Math.Pow(minimumBankfullWidth / 2.5, 2);
        var selected = Enumerable.Range(0, map.Grid.TriangleCount).Select(i => map.WaterKindCodes[i] == 0 && map.FlowEdges[i] >= 0 &&
            (map.RiverOrders[i] > 0 || map.FlowAccumulation[i] * dischargeScale >= minimumDischarge)).ToArray();
        var targets = Enumerable.Range(0, selected.Length).Select(i => selected[i] ? map.Grid.NeighborTriangleIndex(i, map.FlowEdges[i]) : -1).ToArray();
        var incoming = new int[selected.Length];
        foreach (var target in targets.Where(t => t >= 0)) incoming[target]++;
        var result = WaterFeatures(map, input, jobId, locate, scale);
        var receivers = result.ToDictionary(f => f.Attributes["body"]!.GetValue<int>(), f => f.Id);
        var lakeSources = Enumerable.Range(0, map.Grid.TriangleCount).Where(i => map.LakeOutletTargets[i] >= 0 && receivers.ContainsKey(map.WaterBodyIds[i]))
            .GroupBy(i => map.LakeOutletTargets[i]).ToDictionary(g => g.Key, g => g.Select(i => receivers[map.WaterBodyIds[i]]).Distinct().ToList());
        var claimed = new HashSet<int>();
        for (var start = 0; start < selected.Length; start++)
        {
            if (!selected[start] || incoming[start] == 1 || claimed.Contains(start)) continue;
            var chain = new List<int> { start };
            var current = start;
            while (targets[current] is var target && target >= 0)
            {
                claimed.Add(current);
                chain.Add(target);
                if (!selected[target] || incoming[target] != 1) break;
                current = target;
            }
            if (chain.Count < 2) continue;
            var original = Spatial.Line(chain.Select(locate));
            var clipped = Spatial.Read(original).Intersection(shape);
            if (clipped.IsEmpty || clipped.Dimension != Dimension.Curve) continue;
            var attributes = new JsonObject
            {
                ["flow"] = map.FlowAccumulation[chain[^2]] * dischargeScale,
                ["channelWidth"] = 2.5 * Math.Sqrt(map.FlowAccumulation[chain[^2]] * dischargeScale),
                ["flowUnits"] = "m3/s",
                ["basin"] = map.DrainageBasinIds[start],
                ["order"] = map.RiverOrders[start],
                ["elevations"] = new JsonArray(chain.Select(i => (JsonNode?)JsonValue.Create((map.ConditionedDrainageElevation[i] - map.BaseSeaLevel) / 1024d)).ToArray())
            };
            attributes["discharges"] = new JsonArray(chain.Select(i => (JsonNode?)JsonValue.Create(map.FlowAccumulation[i] * dischargeScale)).ToArray());
            attributes["junctionInflows"] = new JsonArray(chain.Select((i, index) => (JsonNode?)JsonValue.Create(index == 0 ? 0 :
                (map.FlowAccumulation[i] - map.FlowAccumulation[chain[index - 1]]) * dischargeScale)).ToArray());
            var originalAttributes = AtlasJson.Clone(attributes);
            attributes["elevations"] = new JsonArray(clipped.Coordinates.Select(c => (JsonNode?)JsonValue.Create(
                Hydrology.ElevationAt(original, originalAttributes, new(c.X, c.Y)) ?? 0)).ToArray());
            attributes["discharges"] = new JsonArray(clipped.Coordinates.Select(c => (JsonNode?)JsonValue.Create(
                Hydrology.DischargeAt(original, originalAttributes, new(c.X, c.Y)))).ToArray());
            attributes["junctionInflows"] = new JsonArray(clipped.Coordinates.Select(c => (JsonNode?)JsonValue.Create(
                VertexInflow(Spatial.Read(original), originalAttributes, c))).ToArray());
            var feature = HumanGeography.Generated(input.World, area, jobId, $"Watercourse {map.DrainageBasinIds[start]}", "river", "rivers", Spatial.Write(clipped),
                $"river-chain:{map.Grid.TriangleIdentity(start)}", attributes);
            feature.Causes = ["priority-conditioned-drainage", "water-balance", "fluvial-and-glacial-history"];
            if (receivers.TryGetValue(map.WaterBodyIds[chain[^1]], out var receiver)) feature.Relations.Add(new(receiver, "flowsInto"));
            foreach (var source in lakeSources.GetValueOrDefault(start) ?? []) feature.Relations.Add(new(source, "flowsFrom"));
            result.Add(feature);
        }
        var identified = PhysicalGeologicalFeatureIdentification.Identify(map);
        foreach (var feature in identified.Features.Values.Where(f => f.Kind is not (PhysicalGeologicalFeatureKind.RiverSystem or PhysicalGeologicalFeatureKind.Lake)))
        {
            var p = locate(feature.AnchorTriangleIndex);
            if (!shape.Covers(Spatial.Point(p))) continue;
            var kind = feature.Kind.ToString().ToLowerInvariant();
            Geometry geometry = Spatial.Point(p);
            if (feature.Kind == PhysicalGeologicalFeatureKind.Lake)
                geometry = UnaryUnionOp.Union(identified.TriangleIndexes(feature.Id).Select(i => Triangle(map, i, locate(i), scale)).ToList()).Intersection(shape);
            if (geometry.IsEmpty) continue;
            result.Add(HumanGeography.Generated(input.World, area, jobId, $"{feature.Kind} {feature.Id}", kind,
                feature.Kind == PhysicalGeologicalFeatureKind.Lake ? "lakes" : "geology", Spatial.Write(geometry), $"geology:{kind}:{feature.Id}",
                new() { ["magnitude"] = feature.Magnitude, ["elevation"] = (map.Elevation[feature.AnchorTriangleIndex] - map.BaseSeaLevel) / 1024d }));
        }
        return result;
    }

    private static double VertexInflow(Geometry geometry, JsonObject attributes, Coordinate point)
    {
        var coordinates = geometry.Coordinates;
        for (var i = 0; i < coordinates.Length; i++)
            if (coordinates[i].Distance(point) < 1e-5) return attributes["junctionInflows"]!.AsArray()[i]!.GetValue<double>();
        return 0;
    }

    private static Geometry Triangle(PhysicalGeographyField map, int i, Position center, double scale)
    {
        var up = map.Grid.TriangleCoordAt(i).Inverted ? -1 : 1;
        var coordinates = new[] { new Coordinate(center.X - scale * up, center.Y), new Coordinate(center.X + scale * .5 * up, center.Y + Math.Sqrt(3) * scale / 2),
            new Coordinate(center.X + scale * .5 * up, center.Y - Math.Sqrt(3) * scale / 2), new Coordinate(center.X - scale * up, center.Y) };
        return Spatial.Factory.CreatePolygon(coordinates);
    }

    public static List<Feature> FromRegional(GenerationInput input, Guid jobId, FieldData field, RegionalGrid grid)
        => RegionalFeatures.Generate(input, jobId, field, grid);
}
