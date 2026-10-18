using Atlas.Domain;

namespace Atlas.Generation;

public static class RegionalMagic
{
    public static IEnumerable<string> Channels(World world) => new[] { "magicHeat", "magicHardening", "magicCoastal", "magicPotential", "naturalTemperature", "naturalRock", "naturalElevation" }
        .Concat(world.Magic.SelectMany(r => new[] { $"magic:{r.Id}", $"magicStored:{r.Id}", $"magicApplied:{r.Id}", $"magicWake:{r.Id}" }));

    public static void Apply(RegionalGrid grid, int epoch, double elapsed)
    {
        foreach (var key in new[] { "magicHeat", "magicHardening", "magicCoastal", "magicPotential" }) Array.Clear(grid[key]);
        foreach (var rule in Magic.Ordered(grid.Input.World.Magic))
        {
            var direct = MagicPropagation.Solve(rule, new RasterMagicMesh(grid.Field), epoch);
            var stored = grid[$"magicStored:{rule.Id}"];
            var wake = grid[$"magicWake:{rule.Id}"];
            var intensity = grid[$"magic:{rule.Id}"];
            var applied = grid[$"magicApplied:{rule.Id}"];
            for (var i = 0; i < grid.Count; i++)
            {
                var retention = rule.Propagation == "cold" ? grid["ice"][i] / (1 + grid["ice"][i]) : 1;
                var loss = Math.Pow(1 - rule.Decay, elapsed);
                stored[i] = stored[i] * loss + direct[i] * rule.Storage * retention * elapsed;
                var value = direct[i] + stored[i];
                foreach (var dependency in rule.DependsOn ?? [])
                    value *= 1 + Math.Abs(grid[$"magic:{dependency}"][i]) / Math.Max(1, Math.Abs(rule.Strength));
                intensity[i] = value; applied[i] = value;
                wake[i] += Math.Abs(value) * elapsed;
                var target = rule.Effect switch { "heat" or "cold" => "magicHeat", "hardening" => "magicHardening", "coastal" => "magicCoastal", _ => "magicPotential" };
                grid[target][i] += rule.Effect == "gravity" ? MagicPhysics.Potential(rule, grid.Position(i)) : rule.Effect == "cold" ? -value : value;
            }
        }
        for (var i = 0; i < grid.Count; i++)
        {
            grid["naturalTemperature"][i] = grid.HasInherited("naturalTemperature") ? grid.Original("naturalTemperature", i) : grid.Original("temperature", i) - grid.Original("magicHeat", i);
            grid["naturalRock"][i] = grid.HasInherited("naturalRock") ? grid.Original("naturalRock", i) : grid.Original("rock", i) - grid.Original("magicHardening", i);
            grid["naturalElevation"][i] = grid.HasInherited("naturalElevation") ? grid.Original("naturalElevation", i) : grid.Original("elevation", i);
            if (!grid.Fixed("rock", i)) grid["rock"][i] = Math.Clamp(grid.Original("rock", i) + grid["magicHardening"][i] - grid.Original("magicHardening", i), 0, 1000);
        }
        grid.Enforce();
    }
}
