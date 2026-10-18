namespace Engine.WorldGen;

internal static class LandscapeSurface
{
    public static void Rebuild(PhysicalGeographyField map, int triangleIndex)
    {
        map.Elevation[triangleIndex] = checked(
            map.BedrockElevation[triangleIndex] + map.SedimentThickness[triangleIndex]);
        map.ReconcileWaterAfterFloorChange(triangleIndex);
    }

    public static long Erode(
        PhysicalGeographyField map,
        int triangleIndex,
        long requested)
    {
        if (requested <= 0)
        {
            return 0;
        }

        var sedimentCut = Math.Min(requested, map.SedimentThickness[triangleIndex]);
        map.SedimentThickness[triangleIndex] -= sedimentCut;
        var bedrockCut = requested - sedimentCut;
        map.BedrockElevation[triangleIndex] -= bedrockCut;
        if (bedrockCut > 0)
        {
            map.SurfaceRockLoad[triangleIndex] = checked(
                map.SurfaceRockLoad[triangleIndex] - bedrockCut);
        }
        Rebuild(map, triangleIndex);
        return requested;
    }

    public static long Deposit(
        PhysicalGeographyField map,
        int triangleIndex,
        long requested)
    {
        var deposited = Math.Max(0, requested);
        map.SedimentThickness[triangleIndex] = checked(
            map.SedimentThickness[triangleIndex] + deposited);
        map.CumulativeDeposition[triangleIndex] = checked(
            map.CumulativeDeposition[triangleIndex] + deposited);
        map.SedimentDepositedTotal = checked(map.SedimentDepositedTotal + deposited);
        Rebuild(map, triangleIndex);
        return deposited;
    }

    public static void Validate(PhysicalGeographyField map)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (!TriangleIsValid(map, triangleIndex))
            {
                throw new InvalidOperationException("Persistent landscape state is inconsistent.");
            }
        }

        if (!TotalsAreValid(map))
        {
            throw new InvalidOperationException("Sediment accounting is inconsistent.");
        }
    }

    private static bool TriangleIsValid(PhysicalGeographyField map, int triangleIndex) =>
        map.SedimentThickness[triangleIndex] >= 0 &&
        map.CumulativeFluvialErosion[triangleIndex] >= 0 &&
        map.CumulativeGlacialErosion[triangleIndex] >= 0 &&
        map.CumulativeGlacialDeposition[triangleIndex] >= 0 &&
        map.CumulativeCoastalErosion[triangleIndex] >= 0 &&
        map.CumulativeDeposition[triangleIndex] >= 0 &&
        map.Elevation[triangleIndex] ==
            map.BedrockElevation[triangleIndex] + map.SedimentThickness[triangleIndex];

    private static bool TotalsAreValid(PhysicalGeographyField map) =>
        map.SedimentProducedTotal >= 0 && map.SedimentDepositedTotal >= 0 &&
        map.SedimentExportedTotal >= 0 &&
        map.SedimentDepositedTotal + map.SedimentExportedTotal <= map.SedimentProducedTotal;
}
