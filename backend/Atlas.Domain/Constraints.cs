namespace Atlas.Domain;

public static class Constraints
{
    public static List<Trait> Effective(World world, Guid areaId)
    {
        var area = world.Areas[areaId];
        if (area.ParentId is not { } parent) return area.Traits.ToList();
        var inherited = Effective(world, parent);
        var local = area.LocalTraits ?? area.Traits.Except(world.Areas[parent].Traits).ToList();
        var result = inherited.Where(t => t.Kind != TraitKind.Derived).ToList();
        foreach (var trait in local)
        {
            if (trait.Kind != TraitKind.Hard) { result.Add(trait); continue; }
            var hard = result.Where(t => t.Kind == TraitKind.Hard && t.Field == trait.Field).ToList();
            var minimum = hard.Select(t => t.Minimum).Append(trait.Minimum).Max();
            var maximum = hard.Select(t => t.Maximum).Append(trait.Maximum).Min();
            Guard.Require(minimum <= maximum, "trait_conflict", $"The local {trait.Field} constraint conflicts with its current ancestor.");
            result.RemoveAll(t => t.Kind == TraitKind.Hard && t.Field == trait.Field);
            result.Add(trait with { Minimum = minimum, Maximum = maximum });
        }
        return result.Distinct().ToList();
    }

    public static void Resolve(World world)
    {
        // Preserve local intent before changing any inherited snapshot.
        foreach (var area in world.Areas.Values.OrderByDescending(a => a.Profile))
            area.LocalTraits ??= area.ParentId is { } parent ? area.Traits.Except(world.Areas[parent].Traits).ToList() : area.Traits.ToList();
        foreach (var area in world.Areas.Values.OrderBy(a => a.Profile)) area.Traits = Effective(world, area.Id);
    }
}
