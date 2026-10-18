using NetTopologySuite.Geometries;
using System.Text.Json;

namespace Atlas.Domain;

public static class Refinement
{
    public static BoundaryContract Contract(World world, Area area, IReadOnlyList<FieldData> fields)
    {
        var parent = world.Areas[area.ParentId!.Value];
        var ancestors = new HashSet<Guid>();
        for (Guid? id = parent.Id; id is { } current; id = world.Areas[current].ParentId) ancestors.Add(current);
        var inherited = fields.Where(f => ancestors.Contains(f.AreaId)).OrderBy(f => world.Areas[f.AreaId].Profile).ToList();
        double At(string channel, Position point) => inherited.LastOrDefault(f => f.Values.ContainsKey(channel))?.Sample(channel, point) ?? 0;
        var crossings = world.Features.Values.Where(f => f.Kind is "river" or "road" or "cave" or "portal" && Composition.Visible(world, f, parent.Id))
            .SelectMany(f => Spatial.Crossings(GeometryFor(world, f, parent.Id), area.Footprint)
                .Select(p => new Crossing(f.Id, p, f.Kind,
                    Hydrology.DischargeAt(GeometryFor(world, f, parent.Id), AttributesFor(world, f, parent.Id), p),
                    Hydrology.ElevationAt(GeometryFor(world, f, parent.Id), AttributesFor(world, f, parent.Id), p) ?? At("elevation", p),
                    Topology.Direction(GeometryFor(world, f, parent.Id), area.Footprint, p),
                    Topology.Identity(world.Id, FormattableString.Invariant($"boundary:{f.Kind}:{p.X:R}:{p.Y:R}")),
                    FlowUncertainty: DischargeUncertainty(world, f, p, inherited, area.Footprint))))
            .ToList();
        crossings = crossings.Select(crossing =>
        {
            var range = Hydrology.FlowRange(crossing);
            foreach (var previous in ancestors.SelectMany(id => world.Areas[id].Boundary?.Crossings ?? [])
                .Where(c => c.FeatureId == crossing.FeatureId && Spatial.Point(c.Point).Distance(Spatial.Point(crossing.Point)) < 1e-5))
            {
                var inheritedRange = Hydrology.FlowRange(previous);
                range = (Math.Max(range.Minimum, inheritedRange.Minimum), Math.Min(range.Maximum, inheritedRange.Maximum));
            }
            Guard.Require(range.Minimum <= range.Maximum, "flow_contract_conflict", "Inherited discharge envelopes do not overlap at this crossing.");
            return crossing with { FlowMinimum = range.Minimum, FlowMaximum = range.Maximum };
        }).ToList();
        var boundary = Spatial.Read(area.Footprint).Boundary;
        var samples = new List<FieldSample>();
        var rings = new List<List<FieldSample>>();
        foreach (var ring in Composition.Parts(boundary))
        {
            var ringSamples = new List<FieldSample>();
            var count = Math.Max(8, (int)Math.Ceiling(64 * ring.Length / boundary.Length));
            var indexed = new NetTopologySuite.LinearReferencing.LengthIndexedLine(ring);
            for (var i = 0; i < count; i++)
            {
                var c = indexed.ExtractPoint(ring.Length * i / count);
                var p = new Position(c.X, c.Y);
                var values = inherited.SelectMany(f => f.Values.Keys).Distinct().ToDictionary(k => k, k => At(k, p));
                ringSamples.Add(new(p, values));
            }
            rings.Add(ringSamples);
            samples.AddRange(ringSamples);
        }
        var hydrology = inherited.LastOrDefault(f => f.Links is not null);
        return new(1, parent.Id, parent.Version, crossings, samples, world.Epochs.ToList(), rings,
            FlowInterfaces.Crossings(hydrology?.Links ?? [], area.Footprint));
    }

    public static double Sample(IReadOnlyList<FieldData> fields, Guid area, string field, Position p) =>
        fields.LastOrDefault(f => f.AreaId == area && f.Values.ContainsKey(field))?.Sample(field, p) ?? 0;

    private static double DischargeUncertainty(World world, Feature feature, Position point, List<FieldData> fields, System.Text.Json.Nodes.JsonObject footprint)
    {
        if (feature.Kind != "river" || feature.State != Materialization.Generated || feature.Protected) return 0;
        if (feature.Detail.Values.Any(d => d.State != Materialization.Generated && Spatial.Read(d.Geometry).Distance(Spatial.Point(point)) < 1e-5)) return 0;
        var field = fields.LastOrDefault(f => f.Values.ContainsKey("flow"));
        if (field is null) return 0;
        var dx = (field.Bounds[2] - field.Bounds[0]) / (field.Width - 1);
        var dy = (field.Bounds[3] - field.Bounds[1]) / (field.Height - 1);
        // A cut through a coarse drainage cell cannot resolve which side owns its runoff
        // or a confluence lying within that cell. Carry that discretization envelope.
        var neighbors = Enumerable.Range(-1, 3).SelectMany(y => Enumerable.Range(-1, 3)
            .Select(x => field.Sample("flow", new(point.X + x * dx, point.Y + y * dy)))).ToArray();
        var localSource = Math.Max(0, field.Sample("runoff", point)) * .001 * dx * dy / (365.25 * 86400);
        var geometry = Composition.Geometry(world, feature);
        var attributes = Composition.Attributes(world, feature, geometry, feature.AreaId);
        var distance = Math.Sqrt(dx * dx + dy * dy);
        var channel = geometry.Coordinates.Where(c => c.Distance(new(point.X, point.Y)) <= distance)
            .Select(c => Hydrology.DischargeAt(Spatial.Write(geometry), attributes, new(c.X, c.Y))).ToArray();
        var channelRange = channel.Length > 0 ? channel.Max() - channel.Min() : 0;
        var boundary = Spatial.Read(footprint).Boundary;
        double cutSources = 0;
        for (var y = 0; y < field.Height; y++)
            for (var x = 0; x < field.Width; x++)
            {
                var p = field.PositionAt(x, y);
                if (boundary.Intersects(Spatial.Read(Spatial.Rectangle(p.X - dx / 2, p.Y - dy / 2, dx, dy))))
                    cutSources += Math.Max(0, field.Sample("runoff", p)) * .001 * dx * dy / (365.25 * 86400);
            }
        return Math.Max(cutSources, Math.Max(channelRange, Math.Max(localSource, neighbors.Max() - neighbors.Min())));
    }

    public static System.Text.Json.Nodes.JsonObject GeometryFor(World world, Feature feature, Guid areaId)
    {
        return Spatial.Write(Composition.Geometry(world, feature));
    }

    public static System.Text.Json.Nodes.JsonObject AttributesFor(World world, Feature feature, Guid areaId)
        => Composition.Attributes(world, feature, Composition.Geometry(world, feature), areaId);

    public static System.Text.Json.Nodes.JsonObject LocalAttributesFor(World world, Feature feature, Guid areaId)
    {
        var result = AtlasJson.Clone(feature.Attributes);
        for (Guid? id = areaId; id is { } current; id = world.Areas[current].ParentId)
        {
            if (!feature.Detail.TryGetValue(current, out var detail) || detail.Attributes is null || detail.NeedsReconciliation || detail.State == Materialization.Stale) continue;
            foreach (var property in detail.Attributes) result[property.Key] = property.Value?.DeepClone();
            break;
        }
        return result;
    }

    public static void ValidateArea(World world, Area area)
    {
        Guard.Require(Enum.IsDefined(area.Profile), "invalid_profile", "Choose a declared creation profile.");
        area.Frame.Validate();
        var shape = Spatial.Read(area.Footprint);
        Guard.Require(shape is Polygon or MultiPolygon, "invalid_footprint", "Mapped areas need polygon footprints.");
        if (area.ParentId is not { } parentId)
        {
            Guard.Require(area.Profile == Profile.World && world.Areas.Values.Count(a => a.ParentId is null && a.Id != area.Id) == 0, "invalid_root", "Only the world root may lack a parent.");
            return;
        }
        Guard.Require(world.Areas.ContainsKey(parentId), "missing_parent", "The geographic parent does not exist.");
        var parent = world.Areas[parentId];
        Guard.Require(area.Profile > parent.Profile, "invalid_profile", "Refinement must move to a finer creation profile; profiles may be skipped.");
        Guard.Require(Spatial.Read(parent.Footprint).Covers(shape), "outside_parent", "The footprint must be contained in its geographic parent.");
        Guard.Require(shape.Covers(Spatial.Point(area.Frame.Origin)), "outside_anchor", "The local origin must lie in the mapped area.");
        foreach (var other in world.Areas.Values.Where(a => a.Id != area.Id && a.Profile == area.Profile))
        {
            var space = Composition.IsSpace(area) ? area.Id : Composition.Space(world, parentId);
            if (Composition.Space(world, other.Id) != space) continue;
            var shared = area.Layers.Keys.Intersect(other.Layers.Keys).Any(k =>
                area.Layers[k] != Materialization.Unmaterialized && other.Layers[k] != Materialization.Unmaterialized);
            Guard.Require(!shared || shape.Intersection(Spatial.Read(other.Footprint)).Area <= 1e-8,
                "overlapping_authority", "This profile already has materialized layer ownership in the selected extent.");
        }
        ValidateTraits(Constraints.Effective(world, parent.Id), area.LocalTraits ?? area.Traits.Except(parent.Traits).ToList());
    }

    public static void ValidateTraits(List<Trait> inherited, List<Trait> proposed)
    {
        foreach (var trait in proposed)
        {
            Guard.Require(double.IsFinite(trait.Minimum) && double.IsFinite(trait.Maximum) && trait.Minimum <= trait.Maximum,
                "invalid_trait", "Trait limits must be finite and ordered.");
            if (trait.Kind == TraitKind.Exception)
            {
                Guard.Require(!string.IsNullOrWhiteSpace(trait.Cause) && trait.Scope is not null,
                    "unexplained_exception", "Exceptions require a causal source and geographic scope.");
                Spatial.Read(trait.Scope!);
            }
            foreach (var hard in inherited.Where(t => t.Kind == TraitKind.Hard && t.Field == trait.Field))
            {
                Guard.Require(trait.Kind != TraitKind.Hard || trait.Minimum >= hard.Minimum && trait.Maximum <= hard.Maximum,
                    "trait_conflict", "A child can narrow inherited hard constraints; use a scoped causal exception for a contradiction.");
            }
        }
    }

    public static void ValidateBoundaryTraits(Area area)
    {
        if (area.Boundary is not { } boundary) return;
        foreach (var trait in area.Traits.Where(t => t.Kind == TraitKind.Hard))
        {
            var key = trait.Field == "relief" ? "elevation" : trait.Field;
            var values = boundary.Samples.Where(s => s.Values.ContainsKey(key) && !area.Traits.Any(t =>
                t.Kind == TraitKind.Exception && t.Field == trait.Field && t.Scope is { } scope && Spatial.Read(scope).Covers(Spatial.Point(s.Point))))
                .Select(s => s.Values[key]).ToList();
            if (values.Count == 0) continue;
            var valid = trait.Field == "relief" ? values.Max() - values.Min() <= trait.Maximum + 1e-6
                : values.All(v => v >= trait.Minimum - 1e-6 && v <= trait.Maximum + 1e-6);
            Guard.Require(valid, "boundary_trait_conflict", "This constraint contradicts fixed parent edge samples. Select a compatible extent or explicitly reconcile the boundary.");
        }
    }

    public static void ValidateCrossings(Area area, Feature feature, System.Text.Json.Nodes.JsonObject geometry)
    {
        if (feature.Kind is not ("river" or "road" or "cave" or "portal")) return;
        if (area.Boundary is not { } contract) return;
        var expected = contract.Crossings.Where(c => c.FeatureId == feature.Id).Select(c => c.Point).ToList();
        var actual = Spatial.Crossings(geometry, area.Footprint);
        const double tolerance = 1e-5;
        var endpoints = Composition.Parts(Spatial.Read(geometry)).OfType<LineString>().SelectMany(line => new[] { line.Coordinates[0], line.Coordinates[^1] }).ToList();
        var attachments = actual.Where(a => !expected.Any(e => Spatial.Point(e).Distance(Spatial.Point(a)) <= tolerance) &&
            endpoints.Any(e => e.Distance(new(a.X, a.Y)) <= tolerance) && feature.Relations.Any(r => r.Kind == "joins" &&
                contract.Crossings.Any(c => c.FeatureId == r.TargetId && c.Kind == feature.Kind && Spatial.Point(c.Point).Distance(Spatial.Point(a)) <= tolerance))).ToList();
        Guard.Require(expected.Count == actual.Count - attachments.Count && expected.All(e => actual.Any(a =>
            Math.Abs(e.X - a.X) <= tolerance && Math.Abs(e.Y - a.Y) <= tolerance)),
            "locked_boundary", $"{feature.Name} has {actual.Count} boundary contacts at {string.Join(", ", actual.Take(3))}; its contract has {expected.Count}. Contracted network crossings are locked. Use explicit boundary reconciliation to move an inlet or outlet.");
        if (feature.Kind != "river") return;
        foreach (var crossing in contract.Crossings.Where(c => c.FeatureId == feature.Id))
        {
            Guard.Require(crossing.Direction == "undirected" || Topology.Direction(geometry, area.Footprint, crossing.Point) == crossing.Direction,
                "locked_direction", "A contracted waterway cannot reverse its inlet/outlet direction during ordinary editing.");
            var height = Hydrology.ElevationAt(geometry, feature.Attributes, crossing.Point);
            Guard.Require(height is null || Math.Abs(height.Value - crossing.Elevation) <= 1e-4,
                "locked_water_level", "A contracted inlet/outlet water level cannot change during ordinary editing.");
            var flow = Hydrology.DischargeAt(geometry, feature.Attributes, crossing.Point);
            var range = Hydrology.FlowRange(crossing);
            Guard.Require(flow >= range.Minimum - 1e-6 && flow <= range.Maximum + 1e-6,
                "locked_flow", "Discharge must remain within the inherited resolution envelope. Reconcile the boundary to change that envelope.");
        }
    }

    public static void ValidateRiver(Feature feature, System.Text.Json.Nodes.JsonObject geometry)
    {
        if (feature.Kind != "river") return;
        Guard.Require(Spatial.Read(geometry) is LineString or MultiLineString, "river_geometry", "Rivers need connected line geometry.");
        if (feature.Attributes["elevations"] is not System.Text.Json.Nodes.JsonArray heights) return;
        Guard.Require(heights.Count == Spatial.Read(geometry).Coordinates.Length, "river_elevations", "Each river vertex needs an elevation.");
        var values = heights.Select(h => h!.Deserialize<double>()).ToArray();
        var lifted = feature.Attributes["liftCause"]?.GetValue<string>();
        var shape = Spatial.Read(geometry);
        var offset = 0;
        for (var i = 0; i < shape.NumGeometries; i++)
        {
            var count = shape.GetGeometryN(i).Coordinates.Length;
            var part = values.Skip(offset).Take(count).ToArray();
            Guard.Require(part.All(double.IsFinite) && (part.Zip(part.Skip(1)).All(p => p.First >= p.Second - 1e-6) || !string.IsNullOrWhiteSpace(lifted)),
                "uphill_river", "River elevation must descend unless an explicit lift mechanism explains it.");
            offset += count;
        }
    }
}
