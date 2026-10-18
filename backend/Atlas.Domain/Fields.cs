using System.Text.Json.Nodes;
using NetTopologySuite.Geometries;
using NetTopologySuite.LinearReferencing;

namespace Atlas.Domain;

public sealed record FieldBoundary(JsonObject Footprint, List<FieldSample> Samples, List<List<FieldSample>>? Rings = null);
public sealed record SampledPatch(double[] Bounds, int Width, int Height, Dictionary<string, double[]> Values, List<WaterBodyState>? WaterBodies = null)
{
    private LakeStorage.Index? _waterIndex;
    public LakeStorage.Index? WaterIndex() => LakeStorage.GetIndex(ref _waterIndex, WaterBodies);
    public double Sample(string channel, Position point) => LakeStorage.Sample(ref _waterIndex, WaterBodies, channel, point) ??
        FieldData.GridValue(Bounds, Width, Height, Values[channel], point, FieldData.IsCategory(channel));
}
public sealed record FieldProtection(Guid Id, JsonObject Footprint, List<string> Channels, string Actor, SampledPatch? Samples = null);
public sealed record FlowLink(Guid Id, Position A, Position B, double Rate, bool Channel);
public sealed record LakeSlice(double Floor, double Area, JsonObject? Footprint = null, double Sediment = 0);
public sealed record WaterBodyState(Guid Id, JsonObject Footprint, List<LakeSlice> Slices, double Volume, double Spill,
    Position? Outlet = null, Position? OutletFrom = null, double Suspended = 0, double? FixedLevel = null, List<Position>? OutletPath = null);
public sealed record FieldEpoch(Epoch Epoch, SampledPatch Surface, List<Guid> Forcing, List<FlowLink>? Links = null);
public sealed record PhysicalBudget(string Epoch, double Rain, double Inflow, double Evaporation, double Outflow,
    double GroundwaterChange, double SurfaceStorageChange, double IceChange, double SedimentProduced, double SedimentDeposited, double SedimentExported,
    double IceImport = 0, double IceExport = 0, double MaterialForcing = 0, double SedimentStorageChange = 0);

public sealed record FieldData(Guid Id, Guid AreaId, double[] Bounds, int Width, int Height,
    Dictionary<string, double[]> Values, string Algorithm, int Seed, FieldBoundary? Boundary = null, List<FieldProtection>? Authored = null,
    List<FieldEpoch>? History = null, List<PhysicalBudget>? Budgets = null, SampledPatch? Initial = null, List<WaterTransfer>? Transfers = null, List<FlowLink>? Links = null,
    double[]? Measures = null, List<WaterBodyState>? WaterBodies = null, List<HumanSnapshot>? HumanHistory = null)
{
    private List<(Geometry Geometry, LengthIndexedLine Index, List<FieldSample> Samples)>? _rings;
    private LakeStorage.Index? _waterIndex;
    public static bool IsCategory(string channel) => channel is "province" or "crustType" or "water" or "landform" or "basin" or "receiver" or "surfaceClass";
    public Position PositionAt(int x, int y) => new(
        Bounds[0] + (Bounds[2] - Bounds[0]) * x / (Width - 1),
        Bounds[1] + (Bounds[3] - Bounds[1]) * y / (Height - 1));

    public double Sample(string field, Position p)
    {
        if (!Values.TryGetValue(field, out var values)) return 0;
        foreach (var mask in (Authored ?? []).AsEnumerable().Reverse())
            if (mask.Samples is not null && mask.Channels.Contains(field) && Spatial.Read(mask.Footprint).Covers(Spatial.Point(p)))
                return mask.Samples.Sample(field, p);
        return SampleBase(field, p);
    }

    public double SampleBase(string field, Position p)
    {
        if (!Values.TryGetValue(field, out var values)) return 0;
        var value = LakeStorage.Sample(ref _waterIndex, WaterBodies, field, p) ?? GridValue(Bounds, Width, Height, values, p, IsCategory(field));
        return IsCategory(field) ? value : Constrain(field, p, value);
    }

    public static double GridValue(double[] bounds, int width, int height, double[] values, Position p, bool discrete = false)
    {
        var gx = Math.Clamp((p.X - bounds[0]) / (bounds[2] - bounds[0]) * (width - 1), 0, width - 1);
        var gy = Math.Clamp((p.Y - bounds[1]) / (bounds[3] - bounds[1]) * (height - 1), 0, height - 1);
        if (Math.Abs(gx - Math.Round(gx)) < 1e-9) gx = Math.Round(gx);
        if (Math.Abs(gy - Math.Round(gy)) < 1e-9) gy = Math.Round(gy);
        if (discrete) return values[(int)Math.Round(gy) * width + (int)Math.Round(gx)];
        var x = Math.Min((int)gx, width - 2);
        var y = Math.Min((int)gy, height - 2);
        var tx = gx - x;
        var ty = gy - y;
        return (1 - ty) * ((1 - tx) * values[y * width + x] + tx * values[y * width + x + 1]) +
            ty * ((1 - tx) * values[(y + 1) * width + x] + tx * values[(y + 1) * width + x + 1]);
    }

    private double Constrain(string field, Position p, double interior)
    {
        if (Boundary is not { Samples.Count: > 0 } profile || !profile.Samples[0].Values.ContainsKey(field)) return interior;
        _rings ??= Composition.Parts(Spatial.Read(profile.Footprint).Boundary).Select((ring, index) =>
            (ring, new LengthIndexedLine(ring), profile.Rings?.ElementAtOrDefault(index) ?? profile.Samples)).ToList();
        var selected = _rings.MinBy(r => r.Geometry.Distance(Spatial.Point(p)));
        var distance = selected.Geometry.Distance(Spatial.Point(p));
        if (distance > 1e-6) return interior;
        var along = selected.Index.Project(new Coordinate(p.X, p.Y)) / selected.Geometry.Length * selected.Samples.Count;
        var index = (int)Math.Floor(along) % selected.Samples.Count;
        var fraction = along - Math.Floor(along);
        if (!selected.Samples[index].Values.TryGetValue(field, out var a)) return interior;
        var b = selected.Samples[(index + 1) % selected.Samples.Count].Values.GetValueOrDefault(field, a);
        var edge = a + (b - a) * fraction;
        return edge;
    }

    public void Validate()
    {
        Guard.Require(Width >= 2 && Height >= 2 && Bounds.Length == 4 && Bounds.All(double.IsFinite) &&
            Bounds[0] < Bounds[2] && Bounds[1] < Bounds[3] &&
            Values.Values.All(v => v.Length == Width * Height && v.All(double.IsFinite)) &&
            (Measures is null || Measures.Length == Width * Height && Measures.All(v => double.IsFinite(v) && v >= 0)),
            "invalid_field", "Fields require a finite grid, valid bounds and complete samples.");
    }
}
