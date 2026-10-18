using Atlas.Domain;
using NetTopologySuite.Geometries;
using Position = Atlas.Domain.Position;

namespace Atlas.Generation;

// All distances/heights are metres; annual liquid flux is m³/year and ice/sediment are m³.
public sealed class RegionalGrid
{
    public const double SecondsPerYear = 365.25 * 86400;
    public const int Halo = 16;
    public FieldData Field { get; }
    public Area Area { get; }
    public GenerationInput Input { get; }
    public bool[] Interior { get; }
    public bool[] Mutable { get; }
    public double CellArea { get; }
    public double[] Measures { get; }
    public double Dx { get; }
    public double Dy { get; }
    public int Count => Field.Width * Field.Height;
    public int[] Receiver { get; }
    public int[] FloodReceiver { get; }
    public double[] Routing { get; }
    public List<int> Order { get; } = [];
    public List<PhysicalBudget> Budgets { get; } = [];
    public List<Feature> Waterways { get; } = [];
    public Dictionary<Guid, Feature> WaterwayReference { get; } = [];
    public Guid OutputId { get; }
    public List<WaterTransfer> WaterTransfers { get; } = [];
    public List<FlowLink> ReceivingLinks { get; } = [];
    public Dictionary<Guid, double> ReceivingSediment { get; } = [];
    public ReceivingWaters Waters { get; }
    public bool[] Ocean { get; }
    public Dictionary<int, SurfaceReservoir> Reservoirs { get; } = [];
    public Dictionary<int, int> LakeRoots { get; } = [];
    public Dictionary<(int From, int To), double> SpillFlows { get; } = [];
    public double[] PendingSediment { get; }
    public HashSet<int> RepresentedLinks { get; } = [];
    public Dictionary<int, (Guid FeatureId, Position Point, double Level)> Channels { get; } = [];
    public Dictionary<int, (Guid FeatureId, Position Point, double Level)> ChannelIntakes { get; } = [];
    public SurfaceRouting? Surface { get; set; }
    public IEnumerable<KeyValuePair<int, (Guid FeatureId, Position Point, double Level)>> AllChannels => Channels.Concat(ChannelIntakes);
    public bool IsChannel(int i) => Channels.ContainsKey(i) || ChannelIntakes.ContainsKey(i);
    public bool TryChannel(int i, out (Guid FeatureId, Position Point, double Level) channel) =>
        ChannelIntakes.TryGetValue(i, out channel) || Channels.TryGetValue(i, out channel);
    public double TemperatureOffset { get; set; }
    public double IceScale { get; set; } = 1;
    public int ReferenceVersion { get; private set; }
    public (int Version, double[] Rain, double[] Vapor)? ClimateReference { get; set; }
    private readonly HashSet<string> inheritedChannels;
    private FieldBoundary? interfaceProfile;
    public bool IsPresent { get; private set; }
    public List<WaterFlux> WaterFluxes { get; private set; } = [];
    private readonly Dictionary<string, double[]> baseline;
    private readonly Dictionary<string, Dictionary<int, double>> fixedValues = [];
    private readonly List<FieldProtection> protection = [];
    private readonly Dictionary<string, List<(Geometry Shape, Trait Trait)>> limits;

    public RegionalGrid(GenerationInput input, Guid jobId, FieldData source, SampledPatch? start, bool present = true)
    {
        Input = input;
        inheritedChannels = source.Values.Keys.ToHashSet();
        OutputId = Registry.Identity(jobId, "physical-field");
        Area = input.World.Areas[input.Request.AreaId];
        IsPresent = present;
        if (present && Area.Boundary is { } contract) interfaceProfile = new(Area.Footprint, contract.Samples, contract.Rings);
        if (present) WaterFluxes = Area.Boundary?.WaterFluxes ?? FlowInterfaces.Crossings(source.Links ?? [], Area.Footprint);
        var size = Registry.Resolution(input.Request.Quality);
        var bounds = Spatial.Bounds(Area.Footprint);
        Dx = (bounds[2] - bounds[0]) / (size - 1);
        Dy = (bounds[3] - bounds[1]) / (size - 1);
        CellArea = Dx * Dy;
        var n = size + Halo * 2;
        var keys = source.Values.Keys.Concat(new[] { "elevation", "bedrock", "sediment", "deposition", "erosion", "glacialErosion", "glacialDeposition",
            "temperature", "rainfall", "snowfall", "moisture", "runoff", "flow", "ice", "glacialHistory", "iceFlux", "groundwater", "surfaceStorage", "waterSurface", "waterDepth", "water",
            "rock", "fracture", "carbonate", "windX", "windY", "channelWidth", "floodplain", "slope", "basin", "massWasting", "coastalErosion", "suspendedSediment" })
            .Concat(RegionalMagic.Channels(input.World)).Distinct();
        Field = new(Registry.Identity(jobId, "regional-work"), Area.Id,
            [bounds[0] - Halo * Dx, bounds[1] - Halo * Dy, bounds[2] + Halo * Dx, bounds[3] + Halo * Dy], n, n,
            keys.ToDictionary(k => k, _ => new double[n * n]), "bounded-physical-v2", input.Request.Seed);
        Interior = new bool[Count]; Mutable = new bool[Count]; Ocean = new bool[Count]; Receiver = Enumerable.Repeat(-1, Count).ToArray(); Routing = new double[Count]; Measures = new double[Count];
        PendingSediment = new double[Count]; FloodReceiver = new int[Count];
        var shape = Spatial.Read(Area.Footprint);
        var normalized = NetTopologySuite.Geometries.Utilities.AffineTransformation.ScaleInstance(1 / Dx, 1 / Dy).Transform(shape);
        var candidates = input.Fields.Where(f => f.Values.ContainsKey("elevation") && Composition.Space(input.World, f.AreaId) == Composition.Space(input.World, Area.Id))
            .OrderByDescending(f => input.World.Areas[f.AreaId].Profile).Select(f => (Field: f, Shape: Spatial.Read(input.World.Areas[f.AreaId].Footprint))).ToList();
        for (var i = 0; i < Count; i++)
        {
            var p = Position(i);
            var point = Spatial.Point(p);
            var cell = Spatial.Read(Spatial.Rectangle(p.X - Dx / 2, p.Y - Dy / 2, Dx, Dy));
            Measures[i] = shape.Intersects(cell) ? (shape.Covers(cell) ? CellArea : shape.Intersection(cell).Area) : 0;
            Interior[i] = Measures[i] > CellArea * 1e-12;
            Mutable[i] = Interior[i] && (Area.Boundary is null || normalized.Boundary.Distance(Spatial.Point(new(p.X / Dx, p.Y / Dy))) > 1);
            var neighbor = candidates.FirstOrDefault(c => c.Shape.Covers(point)).Field ?? source;
            foreach (var (key, values) in Field.Values)
                values[i] = Interior[i] && start?.Values.ContainsKey(key) == true ? start.Sample(key, p) : neighbor.SampleBase(key, p);
            if (Interior[i])
            {
                var stockSource = start ?? new(source.Bounds, source.Width, source.Height, source.Values, source.WaterBodies);
                var support = shape.Covers(cell) ? cell : shape.Intersection(cell);
                foreach (var key in ConservativeSampling.Stocks.Where(stockSource.Values.ContainsKey))
                    Field.Values[key][i] = ConservativeSampling.Average(stockSource, key, support);
                Field.Values["bedrock"][i] = Field.Values["elevation"][i] - Field.Values["sediment"][i];
            }
            if (!source.Values.ContainsKey("bedrock")) Field.Values["bedrock"][i] = Field.Values["elevation"][i] - Field.Values["sediment"][i];
            if (!source.Values.ContainsKey("surfaceStorage") && Field.Values["water"][i] == 2) Field.Values["surfaceStorage"][i] = Math.Max(0, Field.Values["waterDepth"][i]);
        }
        baseline = Field.Values.ToDictionary(k => k.Key, k => k.Value.ToArray());
        ApplyInterface();
        var authoredFields = candidates.OrderBy(c => input.World.Areas[c.Field.AreaId].Profile).Select(c => c.Field).ToList();
        foreach (var owner in authoredFields)
            foreach (var mask in owner.Authored ?? [])
            {
                if (Registry.IsAncestor(input.World, owner.AreaId, Area.Id)) protection.Add(mask);
                var region = Spatial.Read(mask.Footprint);
                foreach (var channel in mask.Channels.Where(Field.Values.ContainsKey))
                {
                    if (!fixedValues.ContainsKey(channel)) fixedValues[channel] = [];
                    for (var i = 0; i < Count; i++)
                        if (region.Covers(Spatial.Point(Position(i)))) fixedValues[channel][i] = mask.Samples?.Sample(channel, Position(i)) ?? owner.Sample(channel, Position(i));
                }
            }
        limits = Area.Traits.Where(t => t.Kind == TraitKind.Hard).GroupBy(t => t.Field == "relief" ? "elevation" : t.Field)
            .ToDictionary(g => g.Key, g => g.Select(t =>
            {
                var scope = shape;
                foreach (var exception in Area.Traits.Where(e => e.Kind == TraitKind.Exception && e.Field == t.Field && e.Scope is not null)) scope = scope.Difference(Spatial.Read(exception.Scope!));
                return (scope, t);
            }).ToList());
        Enforce();
        RefreshOcean();
        Waters = new(this, source);
    }

    public double[] this[string channel] => Field.Values[channel];
    public Position Position(int index) => Field.PositionAt(index % Field.Width, index / Field.Width);
    public int Index(Position p) => Math.Clamp((int)Math.Round((p.Y - Field.Bounds[1]) / Dy), 0, Field.Height - 1) * Field.Width +
        Math.Clamp((int)Math.Round((p.X - Field.Bounds[0]) / Dx), 0, Field.Width - 1);
    public IEnumerable<int> Neighbors(int i)
    {
        var x = i % Field.Width; var y = i / Field.Width;
        for (var dy = -1; dy <= 1; dy++)
            for (var dx = -1; dx <= 1; dx++)
                if ((dx != 0 || dy != 0) && x + dx >= 0 && y + dy >= 0 && x + dx < Field.Width && y + dy < Field.Height)
                    yield return (y + dy) * Field.Width + x + dx;
    }
    public bool Fixed(string key, int i) => !Mutable[i] || IsPresent && fixedValues.GetValueOrDefault(key)?.ContainsKey(i) == true;
    public double Original(string key, int i) => baseline.GetValueOrDefault(key)?[i] ?? 0;
    public bool HasInherited(string key) => inheritedChannels.Contains(key);
    public double AvailableChange(string key, int i, double requested)
    {
        if (Fixed(key, i)) return 0;
        var value = Field.Values[key][i];
        if (key == "elevation" && Channels.TryGetValue(i, out var channel)) requested = Math.Min(requested, Math.Max(0, channel.Level - value));
        foreach (var (scope, trait) in limits.GetValueOrDefault(key) ?? [])
        {
            if (!scope.Covers(Spatial.Point(Position(i)))) continue;
            var middle = (baseline[key].Min() + baseline[key].Max()) / 2;
            var low = trait.Field == "relief" ? middle - trait.Maximum / 2 : trait.Minimum;
            var high = trait.Field == "relief" ? middle + trait.Maximum / 2 : trait.Maximum;
            requested = Math.Clamp(value + requested, low, high) - value;
        }
        return requested;
    }

    public void Advance(SampledPatch next, SampledPatch? previous)
    {
        var before = Field.Values.ToDictionary(k => k.Key, k => k.Value.ToArray());
        foreach (var key in Field.Values.Keys)
            for (var i = 0; i < Count; i++)
            {
                if (!next.Values.ContainsKey(key)) continue;
                var p = Position(i);
                var from = next.Values.ContainsKey("advectionX") ? new Position(next.Sample("advectionX", p), next.Sample("advectionY", p)) : p;
                var residual = Interior[i] && previous?.Values.ContainsKey(key) == true && (Conserved(key) || key.StartsWith("magicStored:", StringComparison.Ordinal) || key.StartsWith("magicWake:", StringComparison.Ordinal))
                    ? FieldData.GridValue(Field.Bounds, Field.Width, Field.Height, before[key], from) - previous.Sample(key, from) : 0;
                var value = next.Sample(key, p) + residual;
                Field.Values[key][i] = Nonnegative(key) ? Math.Max(0, value) : key == "carbonate" ? Math.Clamp(value, 0, 1) : value;
                if (Interior[i] && key == "glacialHistory") Field.Values[key][i] = Math.Max(before[key][i], Field.Values[key][i]);
                baseline[key][i] = next.Sample(key, p);
            }
        for (var i = 0; i < Count; i++) Field.Values["elevation"][i] = Field.Values["bedrock"][i] + Field.Values["sediment"][i];
        ApplyInterface();
        ReferenceVersion++;
        Enforce();
        double Change(string key) => Enumerable.Range(0, Count).Where(i => Interior[i]).Sum(i => (Field.Values[key][i] - before[key][i]) * Measures[i]);
        var groundwater = Change("groundwater"); var surface = Change("surfaceStorage"); var ice = Change("ice");
        var water = groundwater + surface + ice;
        Budgets.Add(new("inherited-material-frame", 0, Math.Max(0, water), 0, Math.Max(0, -water), groundwater, surface, ice, 0, 0, 0,
            MaterialForcing: Change("elevation")));
    }

    private static bool Conserved(string key) => key is "elevation" or "bedrock" or "sediment" or "erosion" or "deposition" or "glacialErosion" or "glacialDeposition" or
        "groundwater" or "surfaceStorage" or "ice" or "glacialHistory" or "massWasting" or "coastalErosion" or "carbonate" or "suspendedSediment";

    private static bool Nonnegative(string key) => key is "sediment" or "erosion" or "deposition" or "glacialErosion" or "glacialDeposition" or "groundwater" or "surfaceStorage" or "ice" or "glacialHistory" or "massWasting" or "coastalErosion" or "suspendedSediment";

    public void RefreshOcean()
    {
        Array.Clear(Ocean);
        var queue = new Queue<int>();
        var sea = Enumerable.Range(0, Count).Where(i => Original("water", i) == 1).Select(i => Original("waterSurface", i)).DefaultIfEmpty(0).Average();
        for (var i = 0; i < Count; i++)
            if (!Mutable[i] && Interior[i] && Original("water", i) == 1 && Field.Values["elevation"][i] < sea ||
                !Interior[i] && Field.Values["elevation"][i] < sea && (Original("water", i) == 1 || !Field.Values.ContainsKey("province")))
            { Ocean[i] = true; queue.Enqueue(i); }
        while (queue.TryDequeue(out var i))
            foreach (var next in Neighbors(i))
                if (!Ocean[next] && Field.Values["elevation"][next] < sea) { Ocean[next] = true; queue.Enqueue(next); }
        for (var i = 0; i < Count; i++) if (Ocean[i]) Field.Values["waterSurface"][i] = sea;
    }

    private void ApplyInterface()
    {
        if (interfaceProfile is not { Samples.Count: > 0 } profile) return;
        var rings = Composition.Parts(Spatial.Read(Area.Footprint).Boundary).ToList();
        var sampler = Field with { Boundary = new(Area.Footprint, profile.Samples, profile.Rings) };
        var channels = profile.Samples.SelectMany(s => s.Values.Keys).ToHashSet();
        for (var i = 0; i < Count; i++)
        {
            if (!Interior[i] || Mutable[i]) continue;
            var p = Position(i);
            var edge = rings.MinBy(r => r.Distance(Spatial.Point(p)))!;
            var indexed = new NetTopologySuite.LinearReferencing.LengthIndexedLine(edge);
            var coordinate = indexed.ExtractPoint(indexed.Project(new(p.X, p.Y)));
            var boundary = new Position(coordinate.X, coordinate.Y);
            foreach (var channel in channels.Where(baseline.ContainsKey))
            {
                var value = FieldData.IsCategory(channel) ? profile.Samples.OrderBy(s => Spatial.Point(s.Point).Distance(Spatial.Point(boundary))).First(s => s.Values.ContainsKey(channel)).Values[channel] : sampler.Sample(channel, boundary);
                baseline[channel][i] = value;
                Field.Values[channel][i] = value;
            }
        }
    }

    public void SetInterface(SampledPatch? historical = null, List<FlowLink>? links = null)
    {
        IsPresent = historical is null;
        if (IsPresent) Waters.Activate();
        WaterFluxes = historical is null ? Area.Boundary?.WaterFluxes ?? FlowInterfaces.Crossings(links ?? [], Area.Footprint) :
            FlowInterfaces.Crossings(links ?? [], Area.Footprint, includeChannels: true);
        if (Area.Boundary is { } contract)
        {
            FieldSample Sample(FieldSample sample) => new(sample.Point, historical!.Values.Keys.ToDictionary(k => k, k => historical.Sample(k, sample.Point)));
            var rings = historical is null ? contract.Rings : contract.Rings?.Select(r => r.Select(Sample).ToList()).ToList();
            var samples = historical is null ? contract.Samples : contract.Samples.Select(Sample).ToList();
            interfaceProfile = new(Area.Footprint, samples, rings);
        }
        ApplyInterface(); Enforce(); ReferenceVersion++;
    }

    public void Enforce()
    {
        foreach (var (key, values) in Field.Values)
        {
            for (var i = 0; i < Count; i++) if (!Mutable[i]) values[i] = baseline[key][i];
            foreach (var (scope, trait) in limits.GetValueOrDefault(key) ?? [])
            {
                var indices = Enumerable.Range(0, Count).Where(i => Interior[i] && scope.Covers(Spatial.Point(Position(i)))).ToList();
                var middle = indices.Count > 0 ? (indices.Min(i => baseline[key][i]) + indices.Max(i => baseline[key][i])) / 2 : 0;
                foreach (var i in indices)
                    values[i] = trait.Field == "relief" ? Math.Clamp(values[i], middle - trait.Maximum / 2, middle + trait.Maximum / 2) : Math.Clamp(values[i], trait.Minimum, trait.Maximum);
            }
            if (IsPresent) foreach (var (i, value) in fixedValues.GetValueOrDefault(key) ?? []) values[i] = value;
        }
        if (IsPresent) foreach (var (i, _) in fixedValues.GetValueOrDefault("elevation") ?? []) Field.Values["bedrock"][i] = Field.Values["elevation"][i] - Field.Values["sediment"][i];
    }

    public FieldData Crop(Guid jobId, List<FieldEpoch> history, SampledPatch? initial)
    {
        var n = Field.Width - Halo * 2;
        var result = new FieldData(Registry.Identity(jobId, "physical-field"), Area.Id, Spatial.Bounds(Area.Footprint), n, n,
            Field.Values.Keys.ToDictionary(k => k, _ => new double[n * n]), Field.Algorithm, Field.Seed,
            Area.Boundary is { } b ? new(Area.Footprint, b.Samples, b.Rings) : null,
            protection.GroupBy(p => p.Id).Select(g => g.Last()).ToList(),
            history, Budgets, initial, WaterTransfers, FlowLinks(), new double[n * n], Waters.Basins.Values.Select(b => b.State).ToList());
        foreach (var key in result.Values.Keys)
            for (var y = 0; y < n; y++) Array.Copy(Field.Values[key], (y + Halo) * Field.Width + Halo, result.Values[key], y * n, n);
        for (var y = 0; y < n; y++) Array.Copy(Measures, (y + Halo) * Field.Width + Halo, result.Measures!, y * n, n);
        Waters.Present(result);
        return result;
    }

    public List<FlowLink> FlowLinks()
    {
        var links = new List<FlowLink>();
        links.AddRange(Surface?.Links() ?? []);
        foreach (var feature in Waterways)
            foreach (var line in Composition.Parts(Spatial.Read(feature.Geometry)).OfType<LineString>())
                for (var i = 1; i < line.Coordinates.Length; i++)
                {
                    var a = new Position(line.Coordinates[i - 1].X, line.Coordinates[i - 1].Y);
                    var b = new Position(line.Coordinates[i].X, line.Coordinates[i].Y);
                    links.Add(new(Registry.Identity(feature.Id, FormattableString.Invariant($"flow:{a.X:R}:{a.Y:R}:{b.X:R}:{b.Y:R}")), a, b,
                        Hydrology.DischargeAt(feature.Geometry, feature.Attributes, a), true));
                }
        foreach (var (edge, rate) in SpillFlows)
        {
            var a = Position(edge.From); var b = Position(edge.To);
            var id = Registry.Identity(Input.World.Id, FormattableString.Invariant($"surface-flow:{a.X:R}:{a.Y:R}:{b.X:R}:{b.Y:R}"));
            var existing = links.FindIndex(l => l.Id == id);
            if (existing >= 0) links[existing] = links[existing] with { Rate = Math.Max(rate, links[existing].Rate) };
            else links.Add(new(id, a, b, rate, false));
        }
        links.AddRange(ReceivingLinks);
        return links;
    }
}
