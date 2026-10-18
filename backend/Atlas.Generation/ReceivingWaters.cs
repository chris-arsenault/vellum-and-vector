using Atlas.Domain;
using NetTopologySuite.Geometries;
using System.Text.Json.Nodes;
using Position = Atlas.Domain.Position;

namespace Atlas.Generation;

public sealed class ReceivingWaters
{
    public sealed record Result(double Outflow, double Volume, double Evaporation, double ExternalInflow);
    public sealed class Basin(WaterBodyState state)
    {
        public WaterBodyState State = state;
        public double Supply;
        public double Loss;
        public Result? Solved;
        public double Capacity(double head) => State.Slices.Sum(s => s.Area * Math.Max(0, head - s.Floor));
        public double Stage(double volume)
        {
            var lo = State.Slices.Min(s => s.Floor);
            var hi = Math.Max(State.Spill, lo) + volume / State.Slices.Sum(s => s.Area);
            for (var i = 0; i < 60; i++)
            {
                var mid = (lo + hi) / 2;
                if (Capacity(mid) > volume) hi = mid; else lo = mid;
            }
            return (lo + hi) / 2;
        }
        // Pure during the network/bank iterations. Apply the final inventory once.
        public Result Evaluate(double delivery)
        {
            var available = State.Volume + Supply + delivery;
            var evaporation = Math.Min(available, Loss);
            available -= evaporation;
            if (State.FixedLevel is { } fixedLevel)
            {
                var required = Capacity(fixedLevel);
                return new(Math.Max(0, available - required), required, evaporation, Math.Max(0, required - available));
            }
            var capacity = Capacity(State.Spill);
            return new(Math.Max(0, available - capacity), Math.Min(available, capacity), evaporation, 0);
        }
    }

    private readonly RegionalGrid grid;
    private readonly FieldData source;
    public Dictionary<Guid, Basin> Basins { get; } = [];
    public Dictionary<int, Guid> Cells { get; } = [];
    private readonly Dictionary<int, double> presentationStock = [];
    public ReceivingWaters(RegionalGrid grid, FieldData source)
    {
        this.grid = grid; this.source = source;
        if (grid.IsPresent) Activate();
    }

    public void Activate()
    {
        if (Basins.Count > 0) return;
        var area = Spatial.Read(grid.Area.Footprint);
        var saved = source.WaterBodies?.ToDictionary(b => b.Id) ?? [];
        foreach (var feature in grid.Input.World.Features.Values.Where(f => f.Kind == "lake" && Composition.Visible(grid.Input.World, f, grid.Area.Id)))
        {
            var geometry = Composition.Geometry(grid.Input.World, feature).Intersection(area);
            if (geometry.IsEmpty || geometry.Area == 0) continue;
            WaterBodyState? state = saved.GetValueOrDefault(feature.Id);
            state ??= LakeStorage.FromFeature(Composition.ForArea(grid.Input.World, feature, grid.Area.Id)!);
            if (state is null) continue;
            var originalVolume = state.Volume;
            var originalArea = Spatial.Read(state.Footprint).Area;
            var clipped = state.Slices.Select(s => s.Footprint is { } footprint ?
                s with { Area = Spatial.Read(footprint).Intersection(area).Area, Footprint = Spatial.Write(Spatial.Read(footprint).Intersection(area)) } :
                s with { Area = s.Area * geometry.Area / originalArea }).Where(s => s.Area > 0).ToList();
            if (clipped.Count == 0) continue;
            var stage = new Basin(state).Stage(originalVolume);
            state = state with
            {
                Footprint = Spatial.Write(geometry),
                Slices = clipped,
                Volume = clipped.Sum(s => s.Area * Math.Max(0, stage - s.Floor)),
                Suspended = originalVolume > 0 ? state.Suspended * clipped.Sum(s => s.Area * Math.Max(0, stage - s.Floor)) / originalVolume : 0,
                FixedLevel = geometry.Intersects(area.Boundary) ? stage : state.FixedLevel
            };
            Basins[state.Id] = new(state);
            for (var i = 0; i < grid.Count; i++)
            {
                if (!grid.Interior[i]) continue;
                var p = grid.Position(i);
                var support = Spatial.Read(Spatial.Rectangle(p.X - grid.Dx / 2, p.Y - grid.Dy / 2, grid.Dx, grid.Dy));
                var overlap = geometry.Intersection(support).Area;
                if (overlap <= 0) continue;
                if (!Cells.TryGetValue(i, out var previous) || Spatial.Read(Basins[previous].State.Footprint).Intersection(support).Area < overlap) Cells[i] = state.Id;
                // Explicit basin inventory owns this water; the raster is its presentation.
                var contribution = Math.Min(grid["surfaceStorage"][i], Math.Max(0, stage - grid["elevation"][i]) * overlap / grid.Measures[i]);
                presentationStock[i] = presentationStock.GetValueOrDefault(i) + contribution;
                grid["surfaceStorage"][i] -= contribution;
            }
        }
    }

    public void Begin(double years)
    {
        foreach (var (cell, stock) in presentationStock)
            if (grid.Fixed("surfaceStorage", cell)) grid["surfaceStorage"][cell] = Math.Max(0, grid["surfaceStorage"][cell] - stock);
        foreach (var basin in Basins.Values)
        {
            basin.Supply = 0; basin.Solved = null;
            var point = Spatial.Read(basin.State.Footprint).InteriorPoint;
            basin.Loss = Math.Max(0, grid.Field.Sample("temperature", new(point.X, point.Y))) * .0003 * years *
                basin.State.Slices.Sum(s => s.Area);
        }
    }

    public void Apply()
    {
        foreach (var basin in Basins.Values)
            if (basin.Solved is { } solved) basin.State = basin.State with { Volume = solved.Volume };
    }

    public void Present(FieldData field)
    {
        foreach (var basin in Basins.Values)
        {
            var level = basin.Stage(basin.State.Volume);
            var shapes = basin.State.Slices.Where(s => s.Floor < level && s.Footprint is not null).Select(s => Spatial.Read(s.Footprint!)).ToList();
            var geometry = shapes.Count > 0 ? NetTopologySuite.Operation.Union.UnaryUnionOp.Union(shapes) : Spatial.Read(basin.State.Footprint);
            for (var y = 0; y < field.Height; y++)
                for (var x = 0; x < field.Width; x++)
                {
                    var p = field.PositionAt(x, y);
                    if (!geometry.Covers(Spatial.Point(p))) continue;
                    var i = y * field.Width + x;
                    field.Values["waterSurface"][i] = level;
                    field.Values["waterDepth"][i] = Math.Max(0, level - field.Values["elevation"][i]);
                    field.Values["surfaceStorage"][i] += field.Values["waterDepth"][i];
                    field.Values["water"][i] = field.Values["waterDepth"][i] > .05 ? 2 : 0;
                }
        }
    }

    public List<Feature> Features(Guid jobId)
    {
        var result = new List<Feature>();
        foreach (var basin in Basins.Values)
        {
            var level = basin.Stage(basin.State.Volume);
            var shapes = basin.State.Slices.Where(s => s.Floor < level && s.Footprint is not null).Select(s => Spatial.Read(s.Footprint!)).ToList();
            var geometry = shapes.Count > 0 ? NetTopologySuite.Operation.Union.UnaryUnionOp.Union(shapes) : Spatial.Read(basin.State.Footprint);
            var original = grid.Input.World.Features.GetValueOrDefault(basin.State.Id);
            var feature = HumanGeography.Generated(grid.Input.World, grid.Area, jobId, original?.Name ?? "Receiving lake", "lake", "lakes",
                Spatial.Write(geometry), $"waterbody:{basin.State.Id}", new()
                {
                    ["storage"] = basin.State.Volume,
                    ["storageUnits"] = "m3",
                    ["waterLevel"] = level,
                    ["suspendedSediment"] = basin.State.Suspended,
                    ["spillElevation"] = basin.State.Spill,
                    ["hypsometry"] = System.Text.Json.JsonSerializer.SerializeToNode(basin.State.Slices, AtlasJson.Options),
                    ["outlet"] = System.Text.Json.JsonSerializer.SerializeToNode(basin.State.Outlet, AtlasJson.Options),
                    ["outletFrom"] = System.Text.Json.JsonSerializer.SerializeToNode(basin.State.OutletFrom, AtlasJson.Options),
                    ["outletPath"] = System.Text.Json.JsonSerializer.SerializeToNode(basin.State.OutletPath, AtlasJson.Options)
                });
            feature.Id = basin.State.Id; result.Add(feature);
        }
        return result;
    }
}
