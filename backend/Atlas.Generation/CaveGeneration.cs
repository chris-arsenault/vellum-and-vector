using Atlas.Domain;
using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.Union;
using System.Text.Json.Nodes;
using Position = Atlas.Domain.Position;

namespace Atlas.Generation;

public static class CaveGeneration
{
    public static List<Feature> Generate(GenerationInput input, Guid jobId, FieldData? physical)
    {
        Guard.Require(physical is not null, "cave_context", "Cave generation needs inherited substrate, fractures and groundwater history.");
        var world = input.World; var area = world.Areas[input.Request.AreaId];
        var field = physical!.AreaId == area.Id ? physical : Runner.ScopeField(physical, area, input.Request.Quality);
        var shape = Spatial.Read(area.Footprint);
        var bounds = Spatial.Bounds(area.Footprint); var spacing = Math.Max(2, Math.Sqrt(shape.Area) / 5);
        var entrance = world.Features.Values.FirstOrDefault(f => f.AreaId == area.Id && f.Kind == "entrance");
        var start = entrance is null ? area.Frame.Origin : new Position(Spatial.Read(entrance.Geometry).Coordinate.X, Spatial.Read(entrance.Geometry).Coordinate.Y, area.Frame.Origin.Z);
        var candidates = new List<(Position Point, double Conductance)>();
        for (var y = bounds[1] + spacing / 2; y < bounds[3]; y += spacing)
            for (var x = bounds[0] + spacing / 2; x < bounds[2]; x += spacing)
            {
                var point = new Position(x, y, area.Frame.Origin.Z);
                if (!shape.Contains(Spatial.Point(point))) continue;
                var conductance = field.Sample("fracture", point) / 1000 + field.Sample("carbonate", point) * (1 + Wetness(field, point));
                if (conductance > .05) candidates.Add((point, conductance));
            }
        Guard.Require(candidates.Count > 0, "cave_material", "The inherited material has no permeable fracture or soluble-rock route. Author a located excavation or a compatible geological context.");
        var selected = new List<Position>(); var nodes = new List<Position> { start }; var result = new List<Feature>();
        foreach (var candidate in candidates.OrderByDescending(c => c.Conductance))
        {
            if (selected.Any(p => Spatial.Point(p).Distance(Spatial.Point(candidate.Point)) < spacing * 1.5)) continue;
            var origin = nodes.MinBy(p => Spatial.Point(p).Distance(Spatial.Point(candidate.Point)))!;
            var path = TerrainRoute.Find(field, area, origin, candidate.Point, (a, b) =>
            {
                var conductivity = .05 + field.Sample("fracture", b) / 1000 + field.Sample("carbonate", b) * Wetness(field, b);
                var headRise = Math.Max(0, field.Sample("elevation", b) - field.Sample("elevation", a));
                return Spatial.Point(a).Distance(Spatial.Point(b)) * (1 + field.Sample("rock", b) / 1000) / conductivity + headRise;
            });
            if (path.Count < 2) continue;
            var index = selected.Count; selected.Add(candidate.Point); nodes.AddRange(path.Skip(1));
            var evolution = path.Select(Evolve).ToList();
            var width = evolution.Select(e => e.Width).ToArray(); var floor = evolution.Select(e => e.Floor).ToArray();
            var flooded = evolution.Select(e => e.Flood).ToArray(); var history = new JsonArray(evolution.Select(e => (JsonNode?)e.History).ToArray());
            var line = Spatial.Read(Spatial.Line(path)); var pieces = new List<Geometry>();
            for (var p = 1; p < path.Count; p++) pieces.Add(Spatial.Read(Spatial.Line([path[p - 1], path[p]])).Buffer((width[p - 1] + width[p]) / 4));
            var passageFloor = UnaryUnionOp.Union(pieces).Intersection(shape);
            var chamber = Spatial.Point(candidate.Point).Buffer(width[^1] * (1 + candidate.Conductance)).Intersection(shape);
            var attributes = Attributes();
            attributes["widths"] = Numbers(width); attributes["floorElevations"] = Numbers(floor); attributes["floodDepths"] = Numbers(flooded);
            attributes["passable"] = width.Min() >= .5 && flooded.Max() < .7;
            attributes["epochHistory"] = history;
            var chamberFeature = HumanGeography.Generated(world, area, jobId, $"Dissolution chamber {index + 1}", "chamber", "structures", Spatial.Write(chamber), $"{area.Id}:chamber:{index}", AtlasJson.Clone(attributes));
            var passage = HumanGeography.Generated(world, area, jobId, $"Passage {index + 1}", "cave", "roads", Spatial.Write(line), $"{area.Id}:passage:{index}", attributes,
                [new(chamberFeature.Id, "connects")]);
            if (index == 0 && entrance is not null) passage.Relations.Add(new(entrance.Id, "access"));
            result.Add(chamberFeature); result.Add(passage);
            result.Add(HumanGeography.Generated(world, area, jobId, "Passage floor", "caveFloor", "structures", Spatial.Write(passageFloor), $"{area.Id}:passage-floor:{index}", AtlasJson.Clone(attributes), [new(passage.Id, "floorOf")]));
            for (var p = 0; p < path.Count; p++)
            {
                if (evolution[p].Collapse > 0)
                    result.Add(HumanGeography.Generated(world, area, jobId, "Collapse rubble", "rubble", "structures", Spatial.Write(Spatial.Point(path[p]).Buffer(Math.Max(.1, evolution[p].Collapse)).Intersection(passageFloor)),
                        $"{area.Id}:rubble:{index}:{p}", Attributes(), [new(passage.Id, "blocks")]));
                if (flooded[p] > 0)
                {
                    var water = Spatial.Point(path[p]).Buffer(width[p] / 2).Intersection(passageFloor);
                    var waterAttributes = Attributes(); waterAttributes["waterDepth"] = flooded[p];
                    result.Add(HumanGeography.Generated(world, area, jobId, "Underground water", "undergroundWater", "lakes", Spatial.Write(water), $"{area.Id}:flood:{index}:{p}", waterAttributes, [new(passage.Id, "floods")]));
                }
                if (evolution[p].Deposit > .01)
                {
                    var deposits = Spatial.Point(path[p]).Buffer(width[p] / 3).Intersection(passageFloor);
                    var depositAttributes = Attributes(); depositAttributes["thickness"] = evolution[p].Deposit;
                    result.Add(HumanGeography.Generated(world, area, jobId, "Water-laid deposits", "deposit", "structures", Spatial.Write(deposits), $"{area.Id}:deposit:{index}:{p}", depositAttributes, [new(passage.Id, "narrows")]));
                }
            }
            var occupied = world.Features.Values.Any(f => f.Kind is "settlement" or "community" && Spatial.Read(f.Geometry).Distance(Spatial.Point(start)) < Math.Sqrt(Spatial.Read(world.Areas[area.ParentId!.Value].Footprint).Area) / 8);
            if (occupied && index == 0)
                result.Add(HumanGeography.Generated(world, area, jobId, "Habitation remains", "hearth", "structures", Spatial.Write(Spatial.Point(candidate.Point)), $"{area.Id}:habitation", Attributes(), [new(chamberFeature.Id, "inside")]));
        }
        return result;

        (double Width, double Floor, double Flood, double Deposit, double Collapse, JsonArray History) Evolve(Position point)
        {
            var aperture = .15 + field.Sample("fracture", point) / 1000;
            double deposited = 0, collapsed = 0; var records = new JsonArray();
            var episodes = field.History is { Count: > 0 } ? field.History : world.Epochs.Select(e => new FieldEpoch(e, new(field.Bounds, field.Width, field.Height, field.Values), [])).ToList();
            foreach (var episode in episodes)
            {
                var past = episode.Surface;
                double At(string key) => past.Values.ContainsKey(key) ? past.Sample(key, point) : field.Sample(key, point);
                var wet = past.Values.ContainsKey("groundwater") ? At("groundwater") : At("moisture") / 1000;
                var carbonate = past.Values.ContainsKey("carbonate") ? At("carbonate") : Math.Max(0, 1 - At("rock") / 1000) * .3;
                var dissolution = episode.Epoch.Hydrology / 1000d * wet * carbonate * (1 + At("fracture") / 1000) / Math.Max(.1, At("rock") / 1000);
                var iceDamage = At("glacialHistory") / 1000 * episode.Epoch.Ice / 1000d;
                aperture += dissolution + iceDamage * .1;
                var collapse = Math.Max(0, aperture - (1.2 + At("rock") / 1000 * 8)) * (1 + iceDamage) * .3;
                var deposit = Math.Max(0, wet * episode.Epoch.Hydrology / 1000d * .02);
                collapsed += collapse; deposited += deposit; aperture = Math.Max(.05, aperture - collapse - deposit);
                records.Add(new JsonObject { ["epoch"] = episode.Epoch.Id, ["dissolution"] = dissolution, ["collapse"] = collapse, ["deposition"] = deposit, ["iceDamage"] = iceDamage });
            }
            var floor = area.Frame.Origin.Z + deposited;
            var aquiferHead = field.Sample("elevation", point) - Math.Max(.5, field.Sample("sediment", point)) + field.Sample("groundwater", point) / .2;
            var flood = field.Values.ContainsKey("groundwater") ? Math.Max(0, aquiferHead - floor) : 0;
            return (aperture, floor, flood, deposited, collapsed, records);
        }
        JsonObject Attributes() => new()
        {
            ["elevation"] = area.Frame.Origin.Z,
            ["floor"] = area.Frame.Floor,
            ["iceDamageHistory"] = Math.Max(0, field.Sample("glacialHistory", start)) / 1000,
            ["historySource"] = field.History is { Count: > 0 } ? "inherited-epoch-surfaces" : "inherited-material-summary"
        };
    }
    private static double Wetness(FieldData field, Position point) => field.Values.ContainsKey("groundwater") ? Math.Min(2, field.Sample("groundwater", point)) : field.Sample("moisture", point) / 1000;
    private static JsonArray Numbers(IEnumerable<double> values) => new(values.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());
}
