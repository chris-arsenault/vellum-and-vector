using NetTopologySuite.Geometries;

namespace Atlas.Domain;

public static class Dependencies
{
    public static HashSet<Guid> Affected(World world, IEnumerable<Guid> changed)
    {
        var result = changed.ToHashSet();
        var queue = new Queue<Guid>(result);
        while (queue.TryDequeue(out var id))
        {
            var nodes = world.NetworkReaches.Values.Where(r => r.FeatureId == id).SelectMany(r => new[] { r.Start, r.End }).ToHashSet();
            var related = world.NetworkReaches.Values.Where(r => nodes.Contains(r.Start) || nodes.Contains(r.End)).Select(r => r.FeatureId)
                .Concat(world.Features.Values.Where(f => f.Relations.Any(r => r.TargetId == id)).Select(f => f.Id))
                .Concat(world.Connections.Values.Where(c => c.A.FeatureId == id || c.B.FeatureId == id)
                    .SelectMany(c => new[] { c.A.FeatureId, c.B.FeatureId }).OfType<Guid>());
            foreach (var next in related)
                if (result.Add(next)) queue.Enqueue(next);
        }
        return result;
    }

    public static void ValidateBindings(World world)
    {
        var done = new HashSet<Guid>();
        foreach (var id in world.Features.Keys) Visit(id, []);
        foreach (var feature in world.Features.Values.Where(f => f.Relations.Any(r => r.Kind == "follows")))
        {
            var geometry = BoundGeometry(world, feature)!;
            Guard.Require(!geometry.IsEmpty && geometry.IsValid && geometry.Dimension == Dimension.Curve,
                "binding_geometry", "A following feature must resolve to nonempty line geometry in its owning area.");
        }
        void Visit(Guid id, HashSet<Guid> path)
        {
            if (done.Contains(id)) return;
            Guard.Require(path.Add(id), "binding_cycle", "Spatial following relationships must be acyclic.");
            foreach (var relation in world.Features[id].Relations.Where(r => r.Kind == "follows"))
            {
                Guard.Require(world.Features.ContainsKey(relation.TargetId), "missing_binding", "A spatial binding must name an existing feature.");
                Visit(relation.TargetId, path);
            }
            path.Remove(id);
            done.Add(id);
        }
    }

    public static Geometry? BoundGeometry(World world, Feature feature)
    {
        var followed = feature.Relations.Where(r => r.Kind == "follows").ToList();
        if (followed.Count == 0) return null;
        var original = Spatial.Read(feature.Geometry);
        Guard.Require(original.Dimension == Dimension.Curve, "binding_geometry", "Following bindings apply to explicit border or route lines, not entire territory polygons.");
        var parts = followed.SelectMany(r => Composition.Parts(Composition.Geometry(world, world.Features[r.TargetId])))
            .Where(g => g.Dimension == original.Dimension).ToList();
        return original.Factory.BuildGeometry(parts).Intersection(Spatial.Read(world.Areas[feature.AreaId].Footprint));
    }
}
