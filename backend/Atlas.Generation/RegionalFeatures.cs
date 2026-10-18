using Atlas.Domain;
using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.Union;
using System.Text.Json;
using System.Text.Json.Nodes;
using Position = Atlas.Domain.Position;

namespace Atlas.Generation;

public static class RegionalFeatures
{
    public static List<Feature> Generate(GenerationInput input, Guid jobId, FieldData field, RegionalGrid grid)
    {
        var result = grid.Waterways.Select(AtlasJson.Clone).ToList();
        var receivingWaters = Lakes(input, jobId, grid, field);
        receivingWaters.AddRange(grid.Waters.Features(jobId));
        result.AddRange(receivingWaters);
        result.AddRange(grid.Surface?.Features(jobId, receivingWaters) ?? []);
        foreach (var group in grid.AllChannels.Select(c => c.Value).GroupBy(c => c.FeatureId))
        {
            var cells = Enumerable.Range(0, grid.Count).Where(i => grid.Interior[i] && grid.TryChannel((int)grid["basin"][i], out var receiver) && receiver.FeatureId == group.Key).ToList();
            if (cells.Count == 0) continue;
            var geometry = UnaryUnionOp.Union(cells.Select(i =>
            {
                var p = grid.Position(i);
                return Spatial.Read(Spatial.Rectangle(p.X - grid.Dx / 2, p.Y - grid.Dy / 2, grid.Dx, grid.Dy));
            }).ToList()).Intersection(Spatial.Read(grid.Area.Footprint));
            var aquifer = HumanGeography.Generated(input.World, grid.Area, jobId, "Connected aquifer", "aquifer", "lakes", Spatial.Write(geometry),
                $"aquifer:{grid.Area.Id}:{group.Key}", new() { ["storedVolume"] = cells.Sum(i => grid["groundwater"][i] * grid.Measures[i]), ["fieldId"] = grid.OutputId.ToString(), ["storageUnits"] = "m3" });
            result.Add(aquifer);
        }
        Classify(input, jobId, field, result);
        return result.GroupBy(f => f.Id).Select(group =>
        {
            var feature = group.First();
            if (group.Count() > 1 && feature.Kind == "lake")
            {
                feature.Geometry = Spatial.Write(UnaryUnionOp.Union(group.Select(f => Spatial.Read(f.Geometry)).ToList()));
                feature.Attributes["storage"] = group.Sum(f => f.Attributes["storage"]!.GetValue<double>());
            }
            return feature;
        }).ToList();
    }

    private static List<Feature> Lakes(GenerationInput input, Guid jobId, RegionalGrid grid, FieldData field)
    {
        var visited = new bool[grid.Count];
        var result = new List<Feature>();
        var shape = Spatial.Read(grid.Area.Footprint);
        for (var start = 0; start < grid.Count; start++)
        {
            if (visited[start] || !grid.Interior[start] || grid.Waters.Cells.ContainsKey(start) || grid["water"][start] != 2 || grid["waterDepth"][start] < .05) continue;
            var cells = new List<int>(); var queue = new Queue<int>(); queue.Enqueue(start); visited[start] = true;
            while (queue.TryDequeue(out var i))
            {
                cells.Add(i);
                foreach (var n in grid.Neighbors(i))
                    if (!visited[n] && grid.Interior[n] && !grid.Waters.Cells.ContainsKey(n) && grid["water"][n] == 2 && grid["waterDepth"][n] >= .05) { visited[n] = true; queue.Enqueue(n); }
            }
            var geometry = UnaryUnionOp.Union(cells.Select(i =>
            {
                var p = grid.Position(i);
                return Spatial.Read(Spatial.Rectangle(p.X - grid.Dx / 2, p.Y - grid.Dy / 2, grid.Dx, grid.Dy));
            }).ToList()).Intersection(shape);
            if (geometry.IsEmpty || geometry.Area == 0) continue;
            var inherited = input.World.Features.Values.Where(f => f.Kind == "lake" && Composition.Visible(input.World, f, grid.Area.Id))
                .Select(f => (Feature: f, Overlap: Composition.Geometry(input.World, f).Intersection(geometry).Area)).OrderByDescending(v => v.Overlap).FirstOrDefault();
            var feature = HumanGeography.Generated(input.World, grid.Area, jobId, inherited.Overlap > 0 ? inherited.Feature.Name : "Receiving lake", "lake", "lakes", Spatial.Write(geometry),
                $"lake:{grid.Area.Id}:{Quantize(grid.Position(start), grid.Field)}", new()
                {
                    ["storage"] = cells.Sum(i => grid["surfaceStorage"][i] * grid.Measures[i]),
                    ["waterLevel"] = cells.Max(i => grid["waterSurface"][i]),
                    ["spillElevation"] = cells.Min(i => grid.Routing[i]),
                    ["storageUnits"] = "m3",
                    ["historyEpochs"] = input.World.Epochs.Count
                });
            if (inherited.Overlap > 0) feature.Id = inherited.Feature.Id;
            var roots = cells.Where(grid.LakeRoots.ContainsKey).Select(i => grid.LakeRoots[i]).Distinct().ToList();
            var support = roots.SelectMany(i => grid.Reservoirs[i].Cells).Distinct().ToList();
            if (support.Count > 0)
            {
                var slices = support.Select(i =>
                {
                    var p = grid.Position(i);
                    var footprint = Spatial.Read(Spatial.Rectangle(p.X - grid.Dx / 2, p.Y - grid.Dy / 2, grid.Dx, grid.Dy)).Intersection(shape);
                    return new LakeSlice(grid["elevation"][i], footprint.Area, Spatial.Write(footprint), grid["sediment"][i]);
                }).ToList();
                var source = roots.MinBy(i => grid.Reservoirs[i].Spill);
                var path = new List<Position>(); var seen = new HashSet<int>();
                for (var i = source; i >= 0 && seen.Add(i); i = grid.FloodReceiver[i])
                {
                    path.Add(grid.Position(i));
                    if (i != source && grid.TryChannel(i, out var station)) { path.Add(station.Point); break; }
                    if (i != source && (grid.Ocean[i] || !grid.Interior[i])) break;
                }
                var state = new WaterBodyState(feature.Id, Spatial.Write(geometry), slices, feature.Attributes["storage"]!.GetValue<double>(),
                    grid.Reservoirs[source].Spill, path.ElementAtOrDefault(1), path[0], OutletPath: path);
                field.WaterBodies!.Add(state);
                feature.Attributes["hypsometry"] = System.Text.Json.JsonSerializer.SerializeToNode(slices, AtlasJson.Options);
                feature.Attributes["spillElevation"] = state.Spill;
                feature.Attributes["outlet"] = System.Text.Json.JsonSerializer.SerializeToNode(state.Outlet, AtlasJson.Options);
                feature.Attributes["outletFrom"] = System.Text.Json.JsonSerializer.SerializeToNode(state.OutletFrom, AtlasJson.Options);
                feature.Attributes["outletPath"] = System.Text.Json.JsonSerializer.SerializeToNode(path, AtlasJson.Options);
            }
            result.Add(feature);
        }
        return result;
    }

    private static void Classify(GenerationInput input, Guid jobId, FieldData field, List<Feature> result)
    {
        field.Values["surfaceClass"] = new double[field.Width * field.Height];
        for (var y = 1; y < field.Height - 1; y++)
            for (var x = 1; x < field.Width - 1; x++)
            {
                var i = y * field.Width + x; var p = field.PositionAt(x, y);
                field.Values["channelWidth"][i] = Math.Max(field.Values["channelWidth"][i], 2.5 * Math.Sqrt(Math.Max(0, field.Values["flow"][i])));
                field.Values["surfaceClass"][i] = field.Values["water"][i] > 0 ? 0 : field.Values["ice"][i] > 1 ? 1 :
                    field.Values["slope"][i] > .5 ? 2 : field.Values["moisture"][i] > 400 ? 3 : field.Values["moisture"][i] > 150 ? 4 : 5;
                var neighbors = new[] { i - 1, i + 1, i - field.Width, i + field.Width };
                var prominence = field.Values["elevation"][i] - neighbors.Min(n => field.Values["elevation"][n]);
                if (prominence < 10 || neighbors.Any(n => field.Values["elevation"][n] >= field.Values["elevation"][i]) || !Spatial.Read(input.World.Areas[field.AreaId].Footprint).Covers(Spatial.Point(p))) continue;
                var nearest = input.World.Features.Values.Where(f => f.Kind == "peak").OrderBy(f => Composition.Geometry(input.World, f).Distance(Spatial.Point(p))).FirstOrDefault();
                var peak = HumanGeography.Generated(input.World, input.World.Areas[field.AreaId], jobId, nearest?.Name ?? "Summit", "peak", "geology", Spatial.Write(Spatial.Point(p)),
                    $"peak:{field.AreaId}:{Quantize(p, field)}", new() { ["elevation"] = field.Values["elevation"][i], ["prominence"] = prominence });
                if (nearest is not null && Composition.Geometry(input.World, nearest).Distance(Spatial.Point(p)) < Math.Max(field.Bounds[2] - field.Bounds[0], field.Bounds[3] - field.Bounds[1]) / 16) peak.Id = nearest.Id;
                result.Add(peak);
            }
    }

    private static string Quantize(Position p, FieldData field) => FormattableString.Invariant($"{Math.Round(p.X, 6)}:{Math.Round(p.Y, 6)}");
    private static JsonArray Numbers(IEnumerable<double> values) => new(values.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());
}
