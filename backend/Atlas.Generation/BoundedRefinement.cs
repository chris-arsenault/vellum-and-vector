using Atlas.Domain;

namespace Atlas.Generation;

public static class BoundedRefinement
{
    public static async Task<(FieldData Field, List<Feature> Rivers)> Generate(GenerationInput input, Guid jobId,
        Func<string, double, Task> stage, CancellationToken cancellation, bool presentOnly = false)
    {
        var area = input.World.Areas[input.Request.AreaId];
        var own = input.Fields.LastOrDefault(f => f.AreaId == area.Id && f.Values.ContainsKey("elevation"));
        var source = own ?? FindParentField(input, area);
        var historical = presentOnly || own?.History is { Count: > 0 };
        var initial = historical ? null : source.Initial;
        var grid = new RegionalGrid(input, jobId, source, initial, present: historical);
        var history = historical ? AtlasJson.Clone(own?.History ?? source.History ?? []) : new List<FieldEpoch>();
        var epochs = area.Boundary?.Epochs ?? input.World.Epochs;
        var previous = initial;
        var episodes = historical ? Array.Empty<Epoch>() : epochs.ToArray();
        for (var e = 0; e < episodes.Length; e++)
        {
            var epoch = episodes[e];
            grid.TemperatureOffset = !historical && source.History is null ? epoch.Temperature : 0;
            grid.IceScale = Math.Clamp(epoch.Ice / 1000d, 0, 1);
            if (!historical && source.History?.ElementAtOrDefault(e) is { } inherited)
            {
                grid.Advance(inherited.Surface, previous);
                grid.SetInterface(inherited.Surface, inherited.Links);
                previous = inherited.Surface;
            }
            await Solve(epoch, 100, recordHistory: true, .1 + .6 * e / episodes.Length);
            var snapshot = grid.Crop(jobId, [], initial);
            history.Add(new(epoch, new(snapshot.Bounds, snapshot.Width, snapshot.Height, AtlasJson.Clone(snapshot.Values)),
                input.World.Magic.Where(r => r.StartsAtEpoch <= e).Select(r => r.Id).ToList(), snapshot.Links));
        }
        if (!historical) grid.Advance(new(source.Bounds, source.Width, source.Height, source.Values, source.WaterBodies), previous);
        grid.SetInterface(links: source.Links);
        grid.TemperatureOffset = 0; grid.IceScale = Math.Clamp(epochs[^1].Ice / 1000d, 0, 1);
        RegionalWaterways.Prepare(grid, jobId);
        await Solve(new("present-response", Tectonics: 0, Ice: epochs[^1].Ice), 1, recordHistory: false, .75);
        var field = grid.Crop(jobId, history, source.Initial ?? initial);
        await stage("Routing maintained waterways and identifying receiving geography", .85);
        var features = PhysicalFeatures.FromRegional(input, jobId, field, grid);
        field = field with { Links = grid.FlowLinks() };
        foreach (var channel in field.Values.Keys) FieldLimits.Validate(area, field, channel);
        field.Validate();
        return (field, features);

        async Task Solve(Epoch epoch, double duration, bool recordHistory, double progress)
        {
            var iterations = input.Request.Quality == "fine" ? 12 : input.Request.Quality == "draft" ? 4 : 8;
            for (var pass = 0; pass < iterations; pass++)
            {
                cancellation.ThrowIfCancellationRequested();
                await stage($"{epoch.Id}: coupled atmosphere, water, ice and sediment {pass + 1}/{iterations}", progress);
                var stocks = new[] { "groundwater", "surfaceStorage", "ice", "glacialHistory" }.ToDictionary(k => k, k => grid[k].ToArray());
                var lakeVolumes = grid.Waters.Basins.ToDictionary(b => b.Key, b => b.Value.State.Volume);
                RegionalMagic.Apply(grid, recordHistory ? Array.FindIndex(episodes, e => e.Id == epoch.Id) : epochs.Count, 1d / iterations);
                RegionalClimate.Solve(grid);
                var years = duration / iterations;
                var ice = RegionalLandscape.Ice(grid, years, recordHistory);
                grid.Enforce();
                RegionalWaterways.Condition(grid);
                RegionalHydrology.Route(grid);
                var budget = RegionalHydrology.Balance(grid, epoch, years, ice.Melt, ice.Change, ice.Import, ice.Export);
                budget = RegionalLandscape.Transport(grid, budget, years, erode: recordHistory);
                RegionalLandscape.HillslopesAndCoasts(grid, years, hillslopes: recordHistory);
                // Re-solve the same water timestep on the changed floor; do not advance time twice.
                foreach (var (key, values) in stocks) Array.Copy(values, grid[key], values.Length);
                foreach (var (id, volume) in lakeVolumes) grid.Waters.Basins[id].State = grid.Waters.Basins[id].State with { Volume = volume };
                grid.Enforce();
                RegionalClimate.Solve(grid);
                var correctedIce = RegionalLandscape.Ice(grid, years, recordHistory, abrade: false);
                grid.Enforce();
                RegionalHydrology.Route(grid);
                var corrected = RegionalHydrology.Balance(grid, epoch, years, correctedIce.Melt, correctedIce.Change, correctedIce.Import, correctedIce.Export);
                grid.Budgets.Add(corrected with { SedimentProduced = budget.SedimentProduced, SedimentDeposited = budget.SedimentDeposited, SedimentExported = budget.SedimentExported, SedimentStorageChange = budget.SedimentStorageChange });
            }
        }
    }

    public static FieldData FindParentField(GenerationInput input, Area area)
    {
        for (var id = area.ParentId; id is { } parent; id = input.World.Areas[parent].ParentId)
        {
            var field = input.Fields.LastOrDefault(f => f.AreaId == parent && f.Values.ContainsKey("elevation"));
            if (field is not null) return field;
        }
        throw new DomainException("unmaterialized_parent", "Generate the parent's physical geography before refining its fields.");
    }

}
