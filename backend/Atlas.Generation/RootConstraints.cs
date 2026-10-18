using Atlas.Domain;
using Engine.WorldGen;

namespace Atlas.Generation;

// The adapter supplies fixed authoring inputs before native layers consume their physical prerequisites.
public sealed class RootConstraints(Area area)
{
    private List<(Trait Trait, List<int> Cells)>? scopes;
    public void Apply(PhysicalGeographyField map)
    {
        if (!area.Traits.Any(t => t.Kind == TraitKind.Hard)) return;
        if (!map.SeaLevelInitialized && area.Traits.Any(t => t.Kind == TraitKind.Hard && t.Field == "elevation"))
        { map.BaseSeaLevel = 0; map.SeaLevelInitialized = true; }
        scopes ??= Prepare(map);
        foreach (var (trait, cells) in scopes)
        {
            if (cells.Count == 0) continue;
            if (trait.Field is "elevation" or "relief" && map.AvailableFacts.HasFlag(PhysicalGeographyFacts.LandscapeHistory))
            {
                var middle = (cells.Min(i => map.Elevation[i]) + cells.Max(i => map.Elevation[i])) / 2048d - map.BaseSeaLevel / 1024d;
                foreach (var i in cells)
                {
                    var current = (map.Elevation[i] - map.BaseSeaLevel) / 1024d;
                    var next = trait.Field == "relief" ? Math.Clamp(current, middle - trait.Maximum / 2, middle + trait.Maximum / 2) : Math.Clamp(current, trait.Minimum, trait.Maximum);
                    var delta = (long)Math.Round(next * 1024) + map.BaseSeaLevel - map.Elevation[i];
                    map.BedrockElevation[i] += delta; map.SurfaceRockLoad[i] += delta;
                    LandscapeSurface.Rebuild(map, i);
                }
            }
            var fact = trait.Field switch
            {
                "temperature" => PhysicalGeographyFacts.Temperature,
                "moisture" => PhysicalGeographyFacts.Moisture,
                "rainfall" => PhysicalGeographyFacts.Precipitation,
                "ice" => PhysicalGeographyFacts.LandIce,
                "fracture" => PhysicalGeographyFacts.Fractures,
                "rock" => PhysicalGeographyFacts.TectonicProvinces,
                _ => PhysicalGeographyFacts.None
            };
            if (fact == PhysicalGeographyFacts.None || !map.AvailableFacts.HasFlag(fact)) continue;
            foreach (var i in cells)
            {
                int Clamp(int value) => (int)Math.Round(Math.Clamp(value, trait.Minimum, trait.Maximum));
                switch (trait.Field)
                {
                    case "temperature": map.Temperature[i] = Clamp(map.Temperature[i]); break;
                    case "moisture": map.Moisture[i] = Clamp(map.Moisture[i]); break;
                    case "rainfall": map.Rainfall[i] = Clamp(map.Rainfall[i]); break;
                    case "ice": map.IceThickness[i] = Clamp(map.IceThickness[i]); map.MaximumIceThickness[i] = Clamp(map.MaximumIceThickness[i]); break;
                    case "fracture": map.FractureConductance[i] = Clamp(map.FractureConductance[i]); break;
                    case "rock": map.RockResistance[i] = Clamp(map.RockResistance[i]); break;
                }
            }
        }
    }

    private List<(Trait, List<int>)> Prepare(PhysicalGeographyField map)
    {
        var bounds = Spatial.Bounds(area.Footprint);
        var scale = Math.Sqrt(Math.Pow(bounds[2] - bounds[0], 2) + Math.Pow(bounds[3] - bounds[1], 2)) / (2 * map.Grid.ContentRadius * .94);
        var result = new List<(Trait, List<int>)>();
        foreach (var trait in area.Traits.Where(t => t.Kind == TraitKind.Hard))
        {
            var region = Spatial.Read(area.Footprint).Buffer(scale * 2);
            foreach (var exception in area.Traits.Where(t => t.Kind == TraitKind.Exception && t.Field == trait.Field && t.Scope is not null)) region = region.Difference(Spatial.Read(exception.Scope!));
            var cells = Enumerable.Range(0, map.Grid.TriangleCount).Where(i => region.Covers(Spatial.Point(new(
                (bounds[0] + bounds[2]) / 2 + map.Grid.TriangleX(i) * scale, (bounds[1] + bounds[3]) / 2 + map.Grid.TriangleY(i) * scale)))).ToList();
            result.Add((trait, cells));
        }
        return result;
    }
}
