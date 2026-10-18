namespace Atlas.Domain;

public static class MagicPhysics
{
    // Gravity strength is an equivalent elevation head in metres.
    public static double Potential(MagicRule rule, Position point)
    {
        if (rule.Scope is { } scope && !Spatial.Read(scope).Covers(Spatial.Point(point))) return 0;
        var distance = Spatial.Point(point).Distance(Spatial.Point(rule.Source));
        return -rule.Strength * Math.Pow(Math.Max(0, 1 - distance / rule.Radius), 2);
    }
}
