namespace Engine.WorldGen;

using Engine.Constants;

/// <summary>
/// Applies a domain-authored, domain-neutral coastal forcing field to the
/// persistent landscape. The source of the forcing remains outside physical
/// worldgen; this layer owns erosion, deposition, and sediment accounting.
/// </summary>
internal sealed class ExternalCoastalForcingLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "external-coastal-forcing",
        0,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.OceanCurrents |
        PhysicalGeographyFacts.LandscapeHistory |
        PhysicalGeographyFacts.SedimentTransport,
        PhysicalGeographyFacts.Elevation | PhysicalGeographyFacts.CoastalEvolution,
        // Natural coastal evolution consumes the post-glacial ocean/current
        // snapshot in the same epoch before these derived facts are rebuilt.
        PhysicalGeographyFacts.Landmasses |
        PhysicalGeographyFacts.Warmth |
        PhysicalGeographyFacts.Temperature |
        PhysicalGeographyFacts.Moisture |
        PhysicalGeographyFacts.Precipitation |
        PhysicalGeographyFacts.AtmosphericFlow |
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
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var forcing = map.ExternalCoastalForcing[triangleIndex];
            if (forcing <= 0)
            {
                continue;
            }

            if (forcing > 1000 || map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.None)
            {
                throw new InvalidOperationException(
                    "External coastal forcing must target dry terrain.");
            }

            var oceanTarget = BestOceanTarget(map, triangleIndex);
            if (oceanTarget < 0)
            {
                // Deposition earlier in this pass can emerge a shallow shelf
                // neighbor, moving the coastline off this cell. The stranded
                // forcing dissipates instead of eroding an inland cell.
                continue;
            }

            map.ExternalCoastalForcingHistory[triangleIndex] = Math.Max(
                map.ExternalCoastalForcingHistory[triangleIndex],
                forcing);
            var cut = PhysicalElevation.FromUnits(
                forcing * context.Profile.MaximumCoastalErosionPerPass *
                    context.CoastalStrength / 1_000_000d);
            if (cut == 0 && context.CoastalStrength > 0)
            {
                cut = 1L;
            }

            if (cut == 0)
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
            DepositOrExport(map, context.Profile, oceanTarget, cut);
        }

        map.ExternalCoastalForcing.Clear();
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        LandscapeSurface.Validate(map);
        foreach (var value in map.ExternalCoastalForcing)
        {
            if (value != 0)
            {
                throw new InvalidOperationException("External coastal forcing history is invalid.");
            }
        }

        foreach (var value in map.ExternalCoastalForcingHistory)
        {
            if (value is < 0 or > 1000)
            {
                throw new InvalidOperationException("External coastal forcing history is invalid.");
            }
        }
    }

    private static int BestOceanTarget(PhysicalGeographyField map, int triangleIndex)
    {
        var target = -1;
        var targetEnergy = int.MaxValue;
        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
            if (neighbor < 0 || map.WaterKindCodes[neighbor] != PhysicalWaterKindCodes.Ocean)
            {
                continue;
            }

            var energy = map.WaveExposure[neighbor] + map.OceanCurrentStrength[neighbor];
            if (energy < targetEnergy)
            {
                target = neighbor;
                targetEnergy = energy;
            }
        }

        return target;
    }

    private static void DepositOrExport(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int target,
        long sediment)
    {
        var deposit = PhysicalElevation.Multiply(sediment, profile.CoastalDepositionFraction, 1000);
        if (deposit > 0)
        {
            _ = LandscapeSurface.Deposit(map, target, deposit);
        }

        map.SedimentExportedTotal = checked(
            map.SedimentExportedTotal + sediment - deposit);
    }
}
