namespace Atlas.Generation;

public static class RegionalClimate
{
    public static void Solve(RegionalGrid grid)
    {
        for (var i = 0; i < grid.Count; i++)
            if (grid.Mutable[i]) grid["temperature"][i] = grid.Original("temperature", i) + grid.TemperatureOffset -
                (grid["elevation"][i] - grid.Original("elevation", i)) * .065 + grid["magicHeat"][i] - grid.Original("magicHeat", i);
        grid.Enforce();
        if (grid.ClimateReference is not { } cached || cached.Version != grid.ReferenceVersion)
        {
            var reference = Transport(grid, reference: true);
            grid.ClimateReference = (grid.ReferenceVersion, reference.Rain, reference.Vapor);
        }
        var background = grid.ClimateReference!.Value;
        var actual = Transport(grid, reference: false);
        for (var i = 0; i < grid.Count; i++)
        {
            if (!grid.Mutable[i]) continue;
            var inherited = Math.Max(0, grid.Original("rainfall", i) + grid.Original("snowfall", i));
            var backgroundRain = grid.HasInherited("rainfall") ? inherited : background.Rain[i];
            var total = Math.Max(0, backgroundRain + actual.Rain[i] - background.Rain[i]);
            var inheritedSnow = inherited > 0 ? grid.Original("snowfall", i) / inherited : Math.Clamp((350 - grid.Original("temperature", i)) / 160, 0, 1);
            var snow = Math.Clamp(inheritedSnow + (grid.Original("temperature", i) - grid["temperature"][i]) / 160, 0, 1);
            grid["snowfall"][i] = total * snow;
            grid["rainfall"][i] = total * (1 - snow);
            grid["moisture"][i] = Math.Max(0, grid.Original("moisture", i) + (actual.Vapor[i] - background.Vapor[i]) * 1000);
        }
        grid.Enforce();
    }

    private static (double[] Rain, double[] Vapor) Transport(RegionalGrid grid, bool reference)
    {
        double At(string channel, int i) => reference ? grid.Original(channel, i) : grid[channel][i];
        var vapor = Enumerable.Range(0, grid.Count).Select(i => Math.Max(0,
            (!reference && grid.Fixed("moisture", i) ? grid["moisture"][i] : grid.Original("moisture", i)) / 1000)).ToArray();
        var precipitation = new double[grid.Count];
        for (var pass = 0; pass < RegionalGrid.Halo; pass++)
        {
            var next = vapor.ToArray();
            for (var i = 0; i < grid.Count; i++)
            {
                var x = i % grid.Field.Width; var y = i / grid.Field.Width;
                var wx = At("windX", i); var wy = At("windY", i);
                if (Math.Abs(wx) + Math.Abs(wy) < 1e-9) wx = 1;
                var normal = Math.Abs(wx) + Math.Abs(wy);
                foreach (var (dx, dy, weight) in new[] { (Math.Sign(wx), 0, Math.Abs(wx) / normal), (0, Math.Sign(wy), Math.Abs(wy) / normal) })
                {
                    if (weight == 0 || x + dx < 0 || y + dy < 0 || x + dx >= grid.Field.Width || y + dy >= grid.Field.Height) continue;
                    var target = (y + dy) * grid.Field.Width + x + dx;
                    var amount = vapor[i] * .4 * weight;
                    next[i] -= amount;
                    var rise = Math.Max(0, At("elevation", target) - At("elevation", i));
                    var cooling = Math.Max(0, At("temperature", i) - At("temperature", target));
                    var condensation = Math.Clamp(.03 + rise / Math.Max(100, grid.Dx * 8) + cooling / 1000, 0, .9);
                    precipitation[target] += amount * condensation;
                    next[target] += amount * (1 - condensation);
                }
                if (reference ? grid.Original("water", i) == 1 : grid.Ocean[i]) next[i] += .03 * Math.Clamp(At("temperature", i) / 1000, .05, 1);
            }
            for (var i = 0; i < grid.Count; i++) vapor[i] = grid.Interior[i] ? Math.Max(0, next[i]) : Math.Max(0, grid.Original("moisture", i) / 1000);
        }
        return (precipitation.Select(p => p / RegionalGrid.Halo * 1000).ToArray(), vapor);
    }
}
