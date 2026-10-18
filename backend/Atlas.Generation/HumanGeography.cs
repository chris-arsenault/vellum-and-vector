using Atlas.Domain;
using System.Text.Json.Nodes;

namespace Atlas.Generation;

public static class HumanGeography
{
    public static (List<Entity> Entities, FieldData Field, List<Feature> Sites) Culture(GenerationInput input, Guid jobId, FieldData physical)
        => Demography.Generate(input, jobId, physical);

    public static (List<Entity> Entities, List<Feature> Features, FieldData Field) Politics(GenerationInput input, Guid jobId, FieldData physical)
        => PoliticalGeography.Generate(input, jobId, physical);

    internal static Position Origin(World world, Entity entity, HumanMesh mesh)
    {
        if (entity.Attributes["center"] is { } center) return AtlasJson.Read<Position>(center);
        var located = world.Features.Values.FirstOrDefault(f => f.Relations.Any(r => r.TargetId == entity.Id && r.Kind is "originOf" or "capitalOf"));
        var point = located is not null ? Spatial.Read(located.Geometry).InteriorPoint : Spatial.Point(mesh.Point(mesh.Cells.MaxBy(i => mesh.Capacity[i])));
        var position = new Position(point.Coordinate.X, point.Coordinate.Y);
        entity.Attributes["center"] = System.Text.Json.JsonSerializer.SerializeToNode(position, AtlasJson.Options);
        return position;
    }

    internal static List<Entity> ExistingOrCreate(World world, string kind, int count, int seed)
    {
        var existing = world.Entities.Values.Where(e => e.Kind == kind).OrderBy(e => e.Id).ToList();
        if (existing.Count > 0) return existing.Select(AtlasJson.Clone).ToList();
        var bounds = Spatial.Bounds(world.Reference.Domain);
        var random = new Random(seed ^ Registry.Identity(world.Id, $"axis:{kind}").GetHashCode());
        return Enumerable.Range(0, count).Select(i => new Entity(Registry.Identity(world.Id, $"{kind}:{i}"),
            $"{kind switch { "culture" => "People", "language" => "Language", "religion" => "Tradition", _ => "Realm" }} {i + 1}", kind,
            new JsonObject
            {
                ["center"] = System.Text.Json.JsonSerializer.SerializeToNode(new Position(
                    bounds[0] + (.15 + random.NextDouble() * .7) * (bounds[2] - bounds[0]),
                    bounds[1] + (.15 + random.NextDouble() * .7) * (bounds[3] - bounds[1])), AtlasJson.Options),
                ["cohesion"] = .65 + random.NextDouble() * .35
            }, [], Materialization.Generated)).ToList();
    }

    internal static Feature Generated(World world, Area area, Guid jobId, string name, string kind,
        string layer, JsonObject geometry, string identity, JsonObject? attributes = null, List<Relation>? relations = null) => new()
        {
            Id = Registry.Identity(world.Id, identity),
            Name = name,
            Kind = kind,
            LayerId = layer,
            AreaId = area.Id,
            Geometry = geometry,
            Attributes = attributes ?? [],
            Relations = relations ?? [],
            Protected = false,
            State = Materialization.Generated,
            GenerationId = jobId,
            Actor = $"generator:{layer}",
            Causes = ["inherited-geography", "historical-present-projection"]
        };
}
