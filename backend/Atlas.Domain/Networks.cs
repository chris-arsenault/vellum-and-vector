namespace Atlas.Domain;

public static class Networks
{
    public static bool ReachesRoad(World world, Guid featureId)
    {
        var queue = new Queue<Guid>(); queue.Enqueue(featureId); var visited = new HashSet<Guid>();
        while (queue.TryDequeue(out var id))
        {
            if (!visited.Add(id) || !world.Features.TryGetValue(id, out var feature)) continue;
            if (feature.Kind == "road") return true;
            foreach (var relation in feature.Relations.Where(r => r.Kind is "connects" or "joins" or "access")) queue.Enqueue(relation.TargetId);
            foreach (var incoming in world.Features.Values.Where(f => f.Relations.Any(r => r.TargetId == id && r.Kind is "connects" or "joins" or "access"))) queue.Enqueue(incoming.Id);
            foreach (var connection in world.Connections.Values)
            {
                if (connection.A.FeatureId == id && connection.B.FeatureId is { } b) queue.Enqueue(b);
                if (connection.B.FeatureId == id && connection.A.FeatureId is { } a) queue.Enqueue(a);
            }
        }
        return false;
    }
    public static void Connect(World world, Connection connection, Impact impact)
    {
        Validate(world, connection);
        world.Connections[connection.Id] = connection;
        foreach (var id in new[] { connection.A.AreaId, connection.B.AreaId }.Distinct())
        {
            world.Areas[id].Version++;
            impact.Areas.Add(id);
        }
    }

    public static void Validate(World world, Connection connection)
    {
        Guard.Require(connection.Id != Guid.Empty && connection.Kind is "entrance" or "vertical" or "portal" or "road" or "river" or "cave",
            "connection_kind", "Use a stable ID and a supported physical, vertical or portal connection.");
        ValidateEnd(world, connection.A);
        ValidateEnd(world, connection.B);
        Guard.Require(connection.A.AreaId != connection.B.AreaId || connection.A.Position != connection.B.Position,
            "connection_loop", "A connection needs two distinct located endpoints.");
        if (connection.Kind != "portal")
            Guard.Require(Spatial.Point(connection.A.Position).Distance(Spatial.Point(connection.B.Position)) < 1e-5,
                "disconnected_network", "Physical cross-area connections must meet at the same horizontal world position. Nonlocal links must be explicit portals.");
        if (connection.Kind == "river")
            Guard.Require(connection.Flow >= 0 && connection.A.Position.Z >= connection.B.Position.Z,
                "network_flow", "A river connection must carry nonnegative flow downstream.");
    }

    private static void ValidateEnd(World world, ConnectionEnd end)
    {
        Guard.Require(world.Areas.TryGetValue(end.AreaId, out var area), "missing_area", "Connection endpoints need existing mapped areas.");
        Guard.Require(double.IsFinite(end.Position.Z) && Spatial.Read(area!.Footprint).Covers(Spatial.Point(end.Position)),
            "connection_location", "Each connection endpoint must resolve inside its mapped area.");
        if (end.FeatureId is not { } id) return;
        Guard.Require(world.Features.TryGetValue(id, out var feature) &&
            Spatial.Read(Refinement.GeometryFor(world, feature, end.AreaId)).Distance(Spatial.Point(end.Position)) < 1e-5,
            "connection_feature", "A connected entrance must meet its referenced spatial feature.");
    }

    public static void AddEntrance(World world, Area area, string actor, Impact impact, IReadOnlyList<FieldData>? fields = null)
    {
        if (area.ParentId is not { } parentId) return;
        var parent = world.Areas[parentId];
        var shape = Spatial.Read(area.Footprint);
        var locatedDoor = world.Features.Values.Where(f => Composition.Visible(world, f, parentId) && f.Kind is "door" or "entrance" or "road" &&
            (area.ContextFeatureId is null || f.Relations.Any(r => r.TargetId == area.ContextFeatureId)))
            .Select(f => (Feature: f, Geometry: Composition.Geometry(world, f).Intersection(shape)))
            .Where(f => !f.Geometry.IsEmpty).OrderBy(f => f.Feature.Kind == "door" ? 0 : f.Feature.Kind == "entrance" ? 1 : 2)
            .ThenBy(f => f.Geometry.Distance(Spatial.Point(area.Frame.Origin))).FirstOrDefault();
        var coordinate = locatedDoor.Feature is not null ? locatedDoor.Geometry.InteriorPoint.Coordinate :
            NetTopologySuite.Operation.Distance.DistanceOp.NearestPoints(shape.Boundary, Spatial.Point(area.Frame.Origin))[0];
        var p = new Position(coordinate.X, coordinate.Y, area.Frame.Origin.Z);
        var entrance = new Feature
        {
            Name = $"{area.Name} entrance",
            Kind = "entrance",
            LayerId = "structures",
            AreaId = area.Id,
            Geometry = Spatial.Write(Spatial.Point(p)),
            Actor = actor,
            Attributes = new() { ["elevation"] = p.Z, ["floor"] = area.Frame.Floor }
        };
        world.Features.Add(entrance.Id, entrance);
        var surface = FieldComposition.At(world, fields ?? [], parentId, "elevation", p);
        var parentPosition = p with { Z = locatedDoor.Feature?.Attributes["elevation"]?.GetValue<double>() ?? surface?.Sample("elevation", p) ?? parent.Frame.Origin.Z };
        Connect(world, new(Guid.NewGuid(), p.Z == parentPosition.Z ? "entrance" : "vertical",
            new(parentId, parentPosition, locatedDoor.Feature?.Id), new(area.Id, p, entrance.Id)), impact);
        if (area.Boundary is { } boundary) area.Boundary = boundary with { ParentVersion = parent.Version };
        impact.Features.Add(entrance.Id);
    }
}
