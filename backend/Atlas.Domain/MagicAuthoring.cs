namespace Atlas.Domain;

public static class MagicAuthoring
{
    public static void Put(World world, MagicRule rule, Impact impact)
    {
        var previous = world.Magic.FirstOrDefault(m => m.Id == rule.Id);
        Guard.Require(previous is null || world.Generations.Count == 0 || previous.StartsAtEpoch >= world.Epochs.Count,
            "fixed_history", "Historical magical forcing is fixed. Add a present-day source instead of rewriting a completed epoch.");
        if (world.Generations.Count > 0) rule = rule with { StartsAtEpoch = world.Epochs.Count };
        Guard.Require(rule.Id != Guid.Empty && rule.Radius > 0 && double.IsFinite(rule.Radius) &&
            double.IsFinite(rule.Strength) && rule.Decay is >= 0 and <= 1 && rule.Storage is >= 0 and <= 1,
            "invalid_magic", "Magic needs finite strength, a positive radius, and decay/storage in [0,1].");
        Guard.Require(rule.Propagation is "radial" or "fracture" or "cold" or "ocean" &&
            rule.Effect is "heat" or "cold" or "hardening" or "coastal" or "gravity",
            "magic_vocabulary", "Use a supported declarative propagation and environmental effect.");
        Guard.Require(Spatial.Read(world.Reference.Domain).Covers(Spatial.Point(rule.Source)), "magic_location", "Magic sources must be located in this world.");
        if (rule.Scope is { } scope)
            Guard.Require(Spatial.Read(world.Reference.Domain).Covers(Spatial.Read(scope)), "magic_scope", "Magic scope must be inside the world.");
        var rules = world.Magic.Where(m => m.Id != rule.Id).Append(rule).ToDictionary(m => m.Id);
        Visit(rule.Id, rules, [], []);
        world.Magic = rules.Values.ToList();
        foreach (var area in world.Areas.Values.Where(a => Spatial.Read(a.Footprint).Distance(Spatial.Point(rule.Source)) < rule.Radius))
        {
            area.Layers["magic"] = Materialization.Stale;
            area.Version++;
            impact.Areas.Add(area.Id);
            Commands.Invalidate(world, area, "magic", impact);
        }
    }

    private static void Visit(Guid id, Dictionary<Guid, MagicRule> rules, HashSet<Guid> path, HashSet<Guid> done)
    {
        Guard.Require(rules.ContainsKey(id), "magic_dependency", "A magical dependency does not exist.");
        if (done.Contains(id)) return;
        Guard.Require(path.Add(id), "magic_cycle", "Declarative magical dependencies must be acyclic.");
        foreach (var dependency in rules[id].DependsOn ?? []) Visit(dependency, rules, path, done);
        path.Remove(id);
        done.Add(id);
    }
}
