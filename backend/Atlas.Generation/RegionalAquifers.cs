namespace Atlas.Generation;

public static class RegionalAquifers
{
    public static (double Inflow, double Outflow) Exchange(RegionalGrid grid, double years)
    {
        double imported = 0, exported = 0;
        var volumes = Enumerable.Range(0, grid.Count).Select(i => Math.Max(0, grid["groundwater"][i]) *
            (grid.Interior[i] ? grid.Measures[i] : grid.CellArea)).ToArray();
        for (var step = 0; step < 16; step++)
        {
            var fluxes = new List<(int Source, int Target, double Volume)>();
            var demand = new double[grid.Count];
            for (var i = 0; i < grid.Count; i++)
                foreach (var n in new[] { i + 1, i + grid.Field.Width })
                {
                    if (n >= grid.Count || n == i + 1 && n / grid.Field.Width != i / grid.Field.Width || !grid.Interior[i] && !grid.Interior[n]) continue;
                    var hi = Head(i); var hn = Head(n);
                    var source = hi >= hn ? i : n; var target = hi >= hn ? n : i;
                    var saturated = Math.Max(0, grid["groundwater"][source]) / Porosity(source);
                    if (saturated == 0) continue;
                    var distance = n == i + 1 ? grid.Dx : grid.Dy;
                    var width = n == i + 1 ? grid.Dy : grid.Dx;
                    var conductivity = Math.Sqrt(Conductivity(i) * Conductivity(n));
                    var volume = conductivity * saturated * width * Math.Abs(hi - hn) / distance *
                        RegionalGrid.SecondsPerYear * years / 16;
                    fluxes.Add((source, target, volume)); demand[source] += volume;
                }
            var delta = new double[grid.Count];
            foreach (var flux in fluxes)
            {
                var amount = flux.Volume * Math.Min(1, volumes[flux.Source] / Math.Max(1e-30, demand[flux.Source]));
                var sourceMutable = grid.Interior[flux.Source] && !grid.Fixed("groundwater", flux.Source);
                var targetMutable = grid.Interior[flux.Target] && !grid.Fixed("groundwater", flux.Target);
                if (sourceMutable) delta[flux.Source] -= amount;
                if (targetMutable) delta[flux.Target] += amount;
                if (!sourceMutable && targetMutable) imported += amount;
                if (sourceMutable && !targetMutable) exported += amount;
            }
            for (var i = 0; i < grid.Count; i++)
            {
                volumes[i] += delta[i];
                if (grid.Interior[i]) grid["groundwater"][i] = Math.Max(0, volumes[i] / grid.Measures[i]);
            }
        }
        return (imported, exported);
        double Porosity(int i) => .15 + Math.Clamp(grid["fracture"][i] / 5000, 0, .2);
        double Head(int i) => grid["elevation"][i] - Math.Max(.5, grid["sediment"][i] + Math.Clamp(grid["fracture"][i] / 1000, 0, 1) * 30) + grid["groundwater"][i] / Porosity(i);
        double Conductivity(int i) => 1e-7 + 2e-5 * Math.Pow(Math.Clamp(grid["fracture"][i] / 1000, 0, 1), 2) + grid["carbonate"][i] * 1e-4;
    }
}
