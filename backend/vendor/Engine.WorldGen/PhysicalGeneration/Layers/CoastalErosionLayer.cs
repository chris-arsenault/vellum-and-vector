namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class CoastalErosionLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "coastal-erosion-and-deposition",
        0,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.OceanCurrents |
        PhysicalGeographyFacts.LandscapeHistory |
        PhysicalGeographyFacts.SedimentTransport,
        PhysicalGeographyFacts.Elevation | PhysicalGeographyFacts.CoastalEvolution,
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.Landmasses |
        PhysicalGeographyFacts.OceanCurrents |
        PhysicalGeographyFacts.Warmth |
        PhysicalGeographyFacts.Temperature |
        PhysicalGeographyFacts.AtmosphericFlow |
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
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        var coastalWave = MeasureCoastalWaveHistory(map);
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var wave = coastalWave[triangleIndex];
            if (wave < context.Profile.CoastalErosionWaveThreshold ||
                map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.None)
            {
                continue;
            }

            var cut = ErosionAmount(map, context.Profile, triangleIndex, wave);
            cut = PhysicalElevation.Multiply(cut, context.CoastalStrength, 1000);
            if (cut <= 0)
            {
                continue;
            }

            _ = LandscapeSurface.Erode(
                map,
                triangleIndex,
                cut);
            map.CumulativeCoastalErosion[triangleIndex] = checked(
                map.CumulativeCoastalErosion[triangleIndex] + cut);
            map.SedimentProducedTotal = checked(map.SedimentProducedTotal + cut);
            DepositOrExport(map, context.Profile, coastalWave, triangleIndex, wave, cut);
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        LandscapeSurface.Validate(map);
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.CumulativeCoastalErosion[triangleIndex] > 0 &&
                map.WaveExposureHistory[triangleIndex] <= 0 &&
                map.ExternalCoastalForcingHistory[triangleIndex] <= 0)
            {
                throw new InvalidOperationException("Coastal erosion lacks wave-exposure history.");
            }
        }
    }

    private static int[] MeasureCoastalWaveHistory(PhysicalGeographyField map)
    {
        var coastalWave = new int[map.Grid.TriangleCount];
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Ocean)
            {
                map.WaveExposureHistory[triangleIndex] = Math.Max(
                    map.WaveExposureHistory[triangleIndex],
                    map.WaveExposure[triangleIndex]);
                continue;
            }

            var wave = AdjacentOceanWave(map, triangleIndex);
            coastalWave[triangleIndex] = wave;
            map.WaveExposureHistory[triangleIndex] = Math.Max(
                map.WaveExposureHistory[triangleIndex],
                wave);
        }

        return coastalWave;
    }

    /// <summary>
    /// How hard this ground is to cut back, derived from facts the generator
    /// already computed rather than from an independent noise field.
    ///
    /// Wave exposure peaks on protruding headlands, so erosion driven by wave
    /// energy alone is a coastline *straightener*: it planes off every
    /// promontory and fills every bay. Real coasts stay ragged because
    /// lithology varies — basalt headlands and orogenic cores survive while
    /// sediment aprons retreat. Differential resistance is what preserves
    /// capes, stacks, and peninsulas instead of grinding them flat.
    /// </summary>
    private static double RockResistance(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int triangleIndex)
    {
        var resistance = map.CrustTypeCodes[triangleIndex] ==
            PhysicalCrustTypeCodes.Continental ? 18d : 12d;

        // Volcanic construction leaves hard rock: necks, flows, and cones
        // become the capes and stacks that survive an eroding shoreline.
        var volcanic = Math.Clamp(
            PhysicalElevation.ToUnits(map.VolcanicConstructionHistory[triangleIndex]) /
                Math.Max(1d, profile.VolcanicConeHeight),
            0d,
            1d);
        resistance += volcanic * profile.VolcanicRockResistance / 100d;

        // Long-lived tectonic activity means deep-seated, competent rock.
        var orogenic = Math.Clamp(
            map.TectonicActivityHistory[triangleIndex] /
                Math.Max(1d, profile.EpochTectonicElevationStep * 2d),
            0d,
            1d);
        resistance += orogenic * profile.OrogenicRockResistance / 100d;

        // Thick sediment is soft: aprons and outwash retreat readily, which is
        // what opens bays between the resistant headlands.
        var sediment = Math.Clamp(
            PhysicalElevation.ToUnits(map.SedimentThickness[triangleIndex]) /
                Math.Max(1d, profile.SoftSedimentDepth),
            0d,
            1d);
        resistance -= sediment * profile.SedimentRockWeakness / 100d;

        return Math.Max(4d, resistance);
    }

    private static int AdjacentOceanWave(PhysicalGeographyField map, int triangleIndex)
    {
        var wave = 0;
        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
            if (neighbor >= 0 && map.WaterKindCodes[neighbor] == PhysicalWaterKindCodes.Ocean)
            {
                wave = Math.Max(wave, map.WaveExposure[neighbor]);
            }
        }

        return wave;
    }

    private static long ErosionAmount(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int triangleIndex,
        int wave)
    {
        var waveExcess = wave - profile.CoastalErosionWaveThreshold;
        var shelfSlope = Math.Clamp(
            map.Slope[triangleIndex] / (double)PhysicalElevation.SubunitsPerUnit,
            0d,
            1000d);
        var forcing = (waveExcess * profile.CoastalErosionStrength / 1000d) +
            (shelfSlope / 18d) + Math.Abs(profile.CoastalSeaLevelChange);
        return PhysicalElevation.FromUnits(Math.Clamp(
            forcing / RockResistance(map, profile, triangleIndex),
            0d,
            profile.MaximumCoastalErosionPerPass));
    }

    private static void DepositOrExport(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int[] coastalWave,
        int source,
        int sourceWave,
        long sediment)
    {
        var target = FindShelteredTarget(map, coastalWave, source, sourceWave);
        var deposit = target < 0
            ? 0
            : PhysicalElevation.Multiply(sediment, profile.CoastalDepositionFraction, 1000);
        if (deposit > 0)
        {
            _ = LandscapeSurface.Deposit(map, target, deposit);
        }

        map.SedimentExportedTotal = checked(
            map.SedimentExportedTotal + sediment - deposit);
    }

    private static int FindShelteredTarget(
        PhysicalGeographyField map,
        int[] coastalWave,
        int source,
        int sourceWave)
    {
        var target = -1;
        var targetWave = sourceWave;
        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = map.Grid.NeighborTriangleIndex(source, edge);
            if (neighbor < 0)
            {
                continue;
            }

            var wave = map.WaterKindCodes[neighbor] == PhysicalWaterKindCodes.Ocean
                ? map.WaveExposure[neighbor]
                : coastalWave[neighbor];
            if (wave < targetWave)
            {
                target = neighbor;
                targetWave = wave;
            }
        }

        return target;
    }
}
