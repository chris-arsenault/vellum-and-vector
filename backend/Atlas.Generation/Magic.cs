using Atlas.Domain;
using Engine.WorldGen;

namespace Atlas.Generation;

public static class Magic
{
    public static double Intensity(MagicRule rule, Position p, double fracture, double cold, double ocean, int epoch)
    {
        epoch -= rule.StartsAtEpoch;
        if (epoch < 0) return 0;
        if (rule.Scope is { } scope && !Spatial.Read(scope).Covers(Spatial.Point(p))) return 0;
        var distance = Math.Sqrt(Math.Pow(p.X - rule.Source.X, 2) + Math.Pow(p.Y - rule.Source.Y, 2));
        var attenuation = Math.Max(0, 1 - distance / rule.Radius);
        var medium = rule.Propagation switch
        {
            "fracture" => 0.2 + fracture / 1000,
            "cold" => 0.2 + cold / 1000,
            "ocean" => ocean,
            _ => 1
        };
        return rule.Strength * attenuation * attenuation * medium * (1 + rule.Storage * epoch) * Math.Pow(1 - rule.Decay, epoch);
    }

    public static void Force(PhysicalGeographyField field, World world, Func<int, Position> locate, int epoch, Dictionary<Guid, double[]>? history = null)
    {
        var mesh = new PhysicalMagicMesh(field, locate);
        foreach (var rule in Ordered(world.Magic))
        {
            if (epoch < rule.StartsAtEpoch) continue;
            var current = MagicPropagation.Solve(rule, mesh, epoch);
            var previous = history?.GetValueOrDefault(rule.Id);
            for (var i = 0; i < field.Grid.TriangleCount; i++)
            {
                var source = field.AdvectionSourceIndex[i];
                var stored = previous is not null && source >= 0 ? previous[source] : 0;
                var iceStorage = rule.Propagation == "cold" ? field.IceThickness[i] / (1000d + field.IceThickness[i]) : 1;
                current[i] += stored * rule.Storage * (1 - rule.Decay) * iceStorage;
                foreach (var dependency in rule.DependsOn ?? [])
                    if (history?.TryGetValue(dependency, out var input) == true) current[i] *= 1 + Math.Abs(input[i]) / Math.Max(1, Math.Abs(rule.Strength));
                var effect = (int)Math.Round(current[i]);
                switch (rule.Effect)
                {
                    case "heat": field.ExternalHeatForcing[i] += effect; break;
                    case "cold": field.ExternalHeatForcing[i] -= effect; break;
                    case "hardening": field.RockResistance[i] = Engine.Constants.PhysicalRock.Clamp(field.RockResistance[i] + effect); break;
                    case "coastal": break;
                }
            }
            if (rule.Effect == "coastal") ApplyCoastalPressure(field, current);
            if (history is not null) history[rule.Id] = current;
        }
    }

    private static void ApplyCoastalPressure(PhysicalGeographyField field, double[] pressure)
    {
        for (var i = 0; i < field.Grid.TriangleCount; i++)
        {
            if (field.WaterKindCodes[i] != Engine.Constants.PhysicalWaterKindCodes.None) continue;
            var forcing = 0d;
            for (var edge = 0; edge < 3; edge++)
            {
                var next = field.Grid.NeighborTriangleIndex(i, edge);
                if (next >= 0 && field.WaterKindCodes[next] == Engine.Constants.PhysicalWaterKindCodes.Ocean)
                    forcing = Math.Max(forcing, pressure[next] * (0.25 + field.WaveExposure[next] / 1000d));
            }
            field.ExternalCoastalForcing[i] = Math.Clamp(field.ExternalCoastalForcing[i] + (int)Math.Round(forcing), 0, 1000);
        }
    }

    public static IEnumerable<MagicRule> Ordered(List<MagicRule> rules)
    {
        var result = new List<MagicRule>();
        var done = new HashSet<Guid>();
        void Add(MagicRule rule)
        {
            if (!done.Add(rule.Id)) return;
            foreach (var id in rule.DependsOn ?? []) Add(rules.Single(r => r.Id == id));
            result.Add(rule);
        }
        foreach (var rule in rules.OrderBy(r => r.Id)) Add(rule);
        return result;
    }

    public static FieldData Field(World world, Area area, FieldData physical, Guid jobId)
    {
        var values = physical.Values.Where(v => v.Key.StartsWith("magic", StringComparison.Ordinal) || v.Key.StartsWith("natural", StringComparison.Ordinal))
            .ToDictionary(v => v.Key, v => v.Value.ToArray());
        if (values.Count == 0) values["magic"] = new double[physical.Width * physical.Height];
        values["temperature"] = physical.Values["temperature"].ToArray();
        values["rock"] = physical.Values["rock"].ToArray();
        return new(Registry.Identity(jobId, "magic-field"), area.Id, physical.Bounds, physical.Width, physical.Height, values, "declarative-magic-v2", physical.Seed,
            area.Boundary is { } boundary ? new(area.Footprint, boundary.Samples) : null);
    }

    public static FieldData EffectivePhysical(FieldData physical, FieldData magic)
    {
        var result = AtlasJson.Clone(physical);
        foreach (var key in new[] { "temperature", "rock" })
        {
            if (!magic.Values.ContainsKey(key)) continue;
            for (var y = 0; y < result.Height; y++)
                for (var x = 0; x < result.Width; x++) result.Values[key][y * result.Width + x] = magic.Sample(key, result.PositionAt(x, y));
        }
        return result;
    }
}
