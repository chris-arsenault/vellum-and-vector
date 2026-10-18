namespace Engine.WorldGen;

using Engine.Constants;

/// <summary>
/// Adds coastline structure at scales the continent builder cannot express.
///
/// Continental potential is a smooth field, and its only roughness sits at
/// continent scale, so the finest coastal signal was roughly ten triangles
/// wide: a two-triangle peninsula or a one-triangle strait was structurally
/// impossible. This layer displaces elevation inside the near-shore band with
/// octaves reaching triangle scale, and warps that band so the shoreline folds
/// rather than merely wobbling.
///
/// Amplitude and character follow margin type, so the detail differentiates
/// coasts instead of making them uniformly ragged: passive platforms break
/// into lobes and offshore banks, convergent margins fragment into arcs and
/// islands, rifted margins cut deep narrow inlets, and transform margins stay
/// comparatively straight.
///
/// It runs on the landscape surface rather than the potential field so it
/// composes with erosion and deposition instead of replacing the causal
/// continent mask with a thresholded noise field.
/// </summary>
internal sealed class CoastalDetailLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "coastal-detail",
        0x2ba7d1,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.TectonicMargins |
        PhysicalGeographyFacts.LandscapeHistory,
        PhysicalGeographyFacts.Elevation,
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.Landmasses |
        PhysicalGeographyFacts.OceanDistance |
        PhysicalGeographyFacts.OceanCurrents |
        PhysicalGeographyFacts.Temperature |
        PhysicalGeographyFacts.Moisture |
        PhysicalGeographyFacts.Precipitation |
        PhysicalGeographyFacts.Runoff |
        PhysicalGeographyFacts.DrainageConditioning |
        PhysicalGeographyFacts.Lakes |
        PhysicalGeographyFacts.FlowRouting |
        PhysicalGeographyFacts.Rivers |
        PhysicalGeographyFacts.LandIce |
        PhysicalGeographyFacts.IceFlow |
        PhysicalGeographyFacts.SeaIce |
        PhysicalGeographyFacts.Landforms |
        PhysicalGeographyFacts.RiverGeometry |
        PhysicalGeographyFacts.Floodplains |
        PhysicalGeographyFacts.Deltas |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        var profile = context.Profile;
        var band = PhysicalElevation.FromUnits(profile.CoastalDetailBand);
        if (band <= 0 || profile.CoastalDetailStrength <= 0)
        {
            return;
        }

        var seaLevel = map.EffectiveSeaLevel;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var height = map.Elevation[triangleIndex] - seaLevel;
            if (Math.Abs(height) > band)
            {
                continue;
            }

            var character = CharacterFor(map.MarginCodes[triangleIndex], profile);
            if (character.Amplitude <= 0d)
            {
                continue;
            }

            // Falls off toward the band edges so the detail cannot punch holes
            // in continental interiors or in deep basins.
            var proximity = 1d - (Math.Abs(height) / (double)band);
            var displacement = CoastalNoise(map, context, triangleIndex, character) *
                character.Amplitude * proximity * proximity;
            var delta = PhysicalElevation.FromUnits(displacement * profile.CoastalDetailStrength / 1000d);
            if (delta == 0)
            {
                continue;
            }

            map.BedrockElevation[triangleIndex] = Math.Clamp(
                map.BedrockElevation[triangleIndex] + delta,
                PhysicalElevation.FromUnits(PhysicalCrust.MinimumHeightUnits),
                PhysicalElevation.FromUnits(PhysicalCrust.MaximumHeightUnits) - map.SedimentThickness[triangleIndex]);
            LandscapeSurface.Rebuild(map, triangleIndex);
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        LandscapeSurface.Validate(map);
        foreach (var value in map.Elevation)
        {
            if (value < PhysicalElevation.FromUnits(PhysicalCrust.MinimumHeightUnits) ||
                value > PhysicalElevation.FromUnits(PhysicalCrust.MaximumHeightUnits))
            {
                throw new InvalidOperationException("Coastal detail produced an invalid elevation.");
            }
        }
    }

    /// <summary>
    /// Warped multi-octave displacement. The warp is what turns a wobbling
    /// contour into a folded one that can enclose bays and cut off islands;
    /// the ridged option produces the elongated fingers characteristic of
    /// fjord and arc coasts rather than rounded lobes.
    /// </summary>
    private static double CoastalNoise(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        int triangleIndex,
        MarginCharacter character)
    {
        var x = map.Grid.TriangleX(triangleIndex);
        var y = map.Grid.TriangleY(triangleIndex);
        var warpScale = Math.Max(1d, character.Scale * 1.7d);
        var warpX = PhysicalNoise.FractalNoise(x, y, context.Seed ^ 0x51a3, warpScale, 3) *
            character.Warp;
        var warpY = PhysicalNoise.FractalNoise(x + 91.7d, y - 43.1d, context.Seed ^ 0x51a3, warpScale, 3) *
            character.Warp;
        var sampleX = x + warpX;
        var sampleY = y + warpY;
        var value = PhysicalNoise.FractalNoise(
            sampleX,
            sampleY,
            context.Seed ^ 0x7c4b,
            character.Scale,
            character.Octaves);
        return character.Ridged ? (2d * Math.Abs(value)) - 1d : value;
    }

    private static MarginCharacter CharacterFor(
        int marginCode,
        PhysicalGeographyGenerationProfile profile) => marginCode switch
        {
            // Broad platforms: wide lobes, offshore banks, gentle warp.
            PhysicalMarginCodes.Passive => new MarginCharacter(
                profile.CoastalDetailPassiveAmplitude / 1000d,
                profile.CoastalDetailScale,
                6,
                profile.CoastalDetailWarp / 1000d,
                Ridged: false),

            // Arcs and island groups: strongest, finest, most folded.
            PhysicalMarginCodes.Convergent => new MarginCharacter(
                profile.CoastalDetailConvergentAmplitude / 1000d,
                profile.CoastalDetailScale * 0.55d,
                6,
                profile.CoastalDetailWarp / 1000d * 1.6d,
                Ridged: true),

            // Deep narrow inlets cut along fracture-like lineations.
            PhysicalMarginCodes.Rifted => new MarginCharacter(
                profile.CoastalDetailRiftedAmplitude / 1000d,
                profile.CoastalDetailScale * 0.7d,
                5,
                profile.CoastalDetailWarp / 1000d * 0.7d,
                Ridged: true),

            // Fault-guided and comparatively straight.
            PhysicalMarginCodes.Transform => new MarginCharacter(
                profile.CoastalDetailTransformAmplitude / 1000d,
                profile.CoastalDetailScale * 1.3d,
                4,
                profile.CoastalDetailWarp / 1000d * 0.35d,
                Ridged: false),

            _ => new MarginCharacter(0d, profile.CoastalDetailScale, 4, 0d, Ridged: false),
        };

    private readonly record struct MarginCharacter(
        double Amplitude,
        double Scale,
        int Octaves,
        double Warp,
        bool Ridged);
}
