using Atlas.Domain;

namespace Atlas.Generation;

public static class RegionalHydrology
{
    public static void Route(RegionalGrid grid)
    {
        grid.RefreshOcean();
        var seen = new bool[grid.Count];
        var queue = new PriorityQueue<int, (double, int)>();
        grid.Order.Clear();
        Array.Fill(grid.Receiver, -1);
        for (var i = 0; i < grid.Count; i++)
        {
            grid.Routing[i] = grid["elevation"][i];
            if (!grid.Interior[i] || grid.Mutable[i] && !grid.Ocean[i] && !grid.Channels.ContainsKey(i) && !grid.Waters.Cells.ContainsKey(i)) continue;
            seen[i] = true;
            grid.Routing[i] = grid.Waters.Cells.TryGetValue(i, out var body) ? grid.Waters.Basins[body].Stage(grid.Waters.Basins[body].State.Volume) :
                grid.Channels.TryGetValue(i, out var channel) ? channel.Level : grid.Ocean[i] ? grid["waterSurface"][i] : grid["elevation"][i];
            queue.Enqueue(i, (grid.Routing[i], i));
        }
        // A root present solve has no contracted edge; its outer raster boundary exchanges with the inherited world.
        if (queue.Count == 0)
            foreach (var i in Enumerable.Range(0, grid.Count).Where(i => grid.Interior[i] && grid.Neighbors(i).Any(n => !grid.Interior[n]))) Seed(i);
        while (queue.TryDequeue(out var i, out _))
        {
            grid.Order.Add(i);
            foreach (var n in grid.Neighbors(i))
            {
                if (!grid.Interior[n] || seen[n]) continue;
                var dx = n % grid.Field.Width - i % grid.Field.Width;
                var dy = n / grid.Field.Width - i / grid.Field.Width;
                if (dx != 0 && dy != 0)
                {
                    var a = i + dx; var b = i + dy * grid.Field.Width;
                    if (grid.Receiver[a] == b || grid.Receiver[b] == a) continue;
                }
                seen[n] = true;
                grid.Receiver[n] = i;
                grid.Routing[n] = Math.Max(grid["elevation"][n], grid.Routing[i]);
                queue.Enqueue(n, (grid.Routing[n], n));
            }
        }
        Guard.Require(Enumerable.Range(0, grid.Count).All(i => !grid.Interior[i] || seen[i]), "drainage_interface", "Each disconnected geographic component needs a receiving interface.");
        RegionalWaterways.Intercept(grid);
        grid.Reservoirs.Clear(); grid.LakeRoots.Clear();
        _ = new SurfaceRouting(grid, condition: true);
        SurfaceReservoirs.Identify(grid);
        grid.Surface = new(grid);
        void Seed(int i)
        {
            seen[i] = true; queue.Enqueue(i, (grid.Routing[i], i));
        }
    }

    public static PhysicalBudget Balance(RegionalGrid grid, Epoch epoch, double years, double[] melt, double iceChange, double iceImport = 0, double iceExport = 0)
    {
        var volume = new double[grid.Count];
        grid.ReceivingLinks.Clear();
        grid.Waters.Begin(years);
        var captured = new double[grid.Count];
        double rain = 0, evaporation = 0, groundwaterChange = 0, storageChange = 0, outflow = 0, externalInflow = 0;
        for (var i = 0; i < grid.Count; i++)
        {
            if (!grid.Interior[i]) continue;
            var area = grid.Measures[i];
            var precipitation = Math.Max(0, grid["rainfall"][i]) * .001 * area * years;
            var liquid = precipitation + melt[i];
            rain += precipitation + Math.Max(0, grid["snowfall"][i]) * .001 * area * years;
            var loss = Math.Min(liquid, liquid * Math.Clamp(.1 + grid["temperature"][i] / 1600, .05, .85));
            evaporation += loss;
            liquid -= loss;
            var infiltration = grid.Fixed("groundwater", i) ? 0 : liquid * Math.Clamp(grid["fracture"][i] / 1600 + grid["carbonate"][i] * .2, 0, .75);
            var oldAquifer = grid["groundwater"][i] * area;
            var release = grid.Fixed("groundwater", i) ? 0 : oldAquifer * (1 - Math.Exp(-years / 50));
            grid["groundwater"][i] += (infiltration - release) / area;
            groundwaterChange += infiltration - release;
            volume[i] = liquid - infiltration + release;
            if (!grid.LakeRoots.ContainsKey(i) && grid["surfaceStorage"][i] > 0 && !grid.Fixed("surfaceStorage", i))
            {
                var drained = grid["surfaceStorage"][i] * area;
                volume[i] += drained; storageChange -= drained; grid["surfaceStorage"][i] = 0;
            }
            if (grid.LakeRoots.ContainsKey(i) && !grid.Fixed("surfaceStorage", i))
            {
                var lakeEvaporation = Math.Min(grid["surfaceStorage"][i], Math.Max(0, grid["temperature"][i]) * .0003 * years) * area;
                grid["surfaceStorage"][i] -= lakeEvaporation / area;
                evaporation += lakeEvaporation; storageChange -= lakeEvaporation;
            }
            grid["runoff"][i] = volume[i] / area / years * 1000;
        }
        var aquifer = RegionalAquifers.Exchange(grid, years);
        externalInflow += aquifer.Inflow; outflow += aquifer.Outflow;
        groundwaterChange += aquifer.Inflow - aquifer.Outflow;
        foreach (var flux in grid.WaterFluxes.Where(f => f.Crossing == "inlet"))
        {
            var step = 2 / Math.Sqrt(Math.Pow(flux.Direction.X / grid.Dx, 2) + Math.Pow(flux.Direction.Y / grid.Dy, 2));
            var point = new Position(flux.Point.X + flux.Direction.X * step, flux.Point.Y + flux.Direction.Y * step);
            var index = grid.Index(point);
            if (!grid.Interior[index]) index = grid.Index(flux.Point);
            var supplied = flux.Rate * RegionalGrid.SecondsPerYear * years;
            volume[index] += supplied; externalInflow += supplied;
        }
        foreach (var i in grid.Order)
        {
            if (grid.Ocean[i])
            {
                grid["waterSurface"][i] = grid.Routing[i]; grid["waterDepth"][i] = Math.Max(0, grid.Routing[i] - grid["elevation"][i]); grid["water"][i] = 1;
            }
            else if (!grid.LakeRoots.ContainsKey(i))
            {
                grid["waterDepth"][i] = grid.Channels.TryGetValue(i, out var channel) ? Math.Max(0, channel.Level - grid["elevation"][i]) : 0;
                grid["waterSurface"][i] = grid["elevation"][i] + grid["waterDepth"][i];
                grid["water"][i] = 0;
            }
        }
        var lakeSupply = new double[grid.Count];
        outflow += grid.Surface!.Route(volume, lakeSupply, captured, years);
        var reservoirs = SurfaceReservoirs.FillAll(grid, lakeSupply, captured, years);
        storageChange += reservoirs.StorageChange; externalInflow += reservoirs.Inflow; outflow += reservoirs.Outflow;
        var network = new ChannelTransport(grid).Solve(captured, years);
        var inflow = network.Inflow + externalInflow + iceImport;
        outflow += network.Outflow + iceExport;
        groundwaterChange += network.Storage;
        storageChange += network.SurfaceStorage; evaporation += network.Evaporation;
        var residual = rain + inflow - evaporation - outflow - groundwaterChange - storageChange - iceChange;
        Guard.Require(Math.Abs(residual) <= Math.Max(1e-4, (rain + inflow) * 1e-9), "water_conservation", "The regional liquid/ice/storage balance did not close.");
        return new(epoch.Id, rain, inflow, evaporation, outflow, groundwaterChange, storageChange, iceChange, 0, 0, 0, iceImport, iceExport);
    }
}
