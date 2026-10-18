using System.Text.Json;

namespace Atlas.Domain;

public sealed record Sculpt(Guid AreaId, string Channel, Position Center, double Radius, double Delta);

public static class FieldEdits
{
    public static FieldData Create(World world, Command command, Impact impact)
    {
        var area = world.Areas[command.Data["areaId"]!.GetValue<Guid>()];
        var layer = command.Data["layerId"]!.GetValue<string>();
        Guard.Require(world.Layers.TryGetValue(layer, out var definition) && definition.Representation == "field" && definition.Profiles.Contains(area.Profile),
            "field_layer", "Select a registered field layer that supports this creation profile.");
        Guard.Require(!world.Fields.Any(f => f.AreaId == area.Id && f.LayerId == layer), "existing_field", "This area/layer already has a field. Sculpt the existing field instead.");
        var size = command.Data["resolution"]?.GetValue<int>() ?? 48;
        var value = command.Data["value"]?.Deserialize<double>() ?? 0;
        Guard.Require(size >= 2 && double.IsFinite(value), "invalid_field", "A field needs at least two samples per axis and a finite initial value.");
        area.Layers[layer] = Materialization.Authored;
        Refinement.ValidateArea(world, area);
        var field = new FieldData(command.OperationId, area.Id, Spatial.Bounds(area.Footprint), size, size,
            new() { [layer] = Enumerable.Repeat(value, checked(size * size)).ToArray() }, "authored-field-v1", world.Seed);
        world.Fields.Add(new(field.Id, area.Id, layer, field.Algorithm, command.OperationId, size * size, [layer]));
        area.Version++;
        impact.Areas.Add(area.Id);
        impact.Layers.Add(layer);
        return field;
    }

    public static FieldData Sculpt(World world, Command command, IReadOnlyList<FieldData> fields, Impact impact, bool reconcile = false, string actor = "user")
    {
        var input = AtlasJson.Read<Sculpt>(command.Data);
        Guard.Require(double.IsFinite(input.Radius) && input.Radius > 0 && double.IsFinite(input.Delta),
            "invalid_brush", "A field brush needs a finite positive radius and finite change.");
        Guard.Require(world.Areas.TryGetValue(input.AreaId, out var area), "missing_area", "Select a mapped area.");
        var original = fields.LastOrDefault(f => f.AreaId == area!.Id && f.Values.ContainsKey(input.Channel));
        Guard.Require(original is not null, "unmaterialized_field", "Materialize this area's field before sculpting it.");
        var registered = world.Fields.Single(f => f.Id == original!.Id);
        var brush = Spatial.Point(input.Center).Buffer(input.Radius);
        Guard.Require(!actor.StartsWith("agent:", StringComparison.Ordinal) ||
            area!.Layers.GetValueOrDefault(registered.LayerId) != Materialization.Protected &&
            (original!.Authored is { } masks ? !masks.Any(m => m.Channels.Contains(input.Channel) && Spatial.Read(m.Footprint).Intersects(brush))
                : area.Layers.GetValueOrDefault(registered.LayerId) != Materialization.Authored),
            "protected_field", "The brush intersects authored or protected field samples.");
        var shape = Spatial.Read(area!.Footprint);
        Guard.Require(shape.Covers(Spatial.Point(input.Center)), "outside_area", "The brush center must lie in this area.");
        Guard.Require(area.Boundary is null || shape.Boundary.Distance(Spatial.Point(input.Center)) > input.Radius,
            "locked_boundary", "A local field brush cannot cross the locked boundary.");
        var samples = FreezeBrush(original!, input);
        var authored = (original!.Authored ?? []).Append(new FieldProtection(command.OperationId,
            Spatial.Write(brush.Intersection(shape)), [input.Channel], actor, samples)).ToList();
        var field = AtlasJson.Clone(original!) with { Id = command.OperationId, Algorithm = "authored-field-v1", Authored = authored };
        FieldLimits.Validate(area, field, input.Channel);
        field.Validate();
        foreach (var child in world.Areas.Values.Where(a => !reconcile && a.Id != area.Id && IsDescendant(world, area.Id, a)))
            foreach (var sample in child.Boundary?.Samples ?? [])
                if (sample.Values.ContainsKey(input.Channel))
                    Guard.Require(Math.Abs(field.Sample(input.Channel, sample.Point) - original!.Sample(input.Channel, sample.Point)) <= 1e-6,
                        "locked_field_boundary", "This brush changes a descendant's fixed environmental edge. Edit away from that edge or reconcile the affected boundary.");
        var reference = world.Fields.Single(f => f.Id == original!.Id);
        world.Fields.Remove(reference);
        world.Fields.Add(reference with { Id = field.Id, Algorithm = field.Algorithm });
        area.Layers[reference.LayerId] = Materialization.Authored;
        area.Version++;
        impact.Areas.Add(area.Id);
        impact.Layers.Add(reference.LayerId);
        Commands.Invalidate(world, area, reference.LayerId, impact);
        return field;
    }

    private static bool IsDescendant(World world, Guid parent, Area area)
    {
        for (var id = area.ParentId; id is { } current; id = world.Areas[current].ParentId)
            if (current == parent) return true;
        return false;
    }

    private static SampledPatch FreezeBrush(FieldData original, Sculpt brush)
    {
        var bounds = new[] { Math.Max(original.Bounds[0], brush.Center.X - brush.Radius), Math.Max(original.Bounds[1], brush.Center.Y - brush.Radius),
            Math.Min(original.Bounds[2], brush.Center.X + brush.Radius), Math.Min(original.Bounds[3], brush.Center.Y + brush.Radius) };
        var width = Math.Max(2, (int)Math.Ceiling((bounds[2] - bounds[0]) / (original.Bounds[2] - original.Bounds[0]) * (original.Width - 1)) + 1);
        var height = Math.Max(2, (int)Math.Ceiling((bounds[3] - bounds[1]) / (original.Bounds[3] - original.Bounds[1]) * (original.Height - 1)) + 1);
        var values = new double[width * height];
        for (var y = 0; y < height; y++)
            for (var x = 0; x < width; x++)
            {
                var p = new Position(bounds[0] + (bounds[2] - bounds[0]) * x / (width - 1), bounds[1] + (bounds[3] - bounds[1]) * y / (height - 1));
                var weight = Math.Max(0, 1 - Spatial.Point(p).Distance(Spatial.Point(brush.Center)) / brush.Radius);
                values[y * width + x] = original.Sample(brush.Channel, p) + brush.Delta * weight * weight;
            }
        return new(bounds, width, height, new() { [brush.Channel] = values });
    }
}
