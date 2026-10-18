namespace Engine.WorldGen;

using Engine.Constants;

internal static class GlacierSurface
{
    public static long SupportElevation(PhysicalGeographyField map, int triangleIndex) =>
        map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.None
            ? map.Elevation[triangleIndex]
            : map.WaterSurfaceElevations[triangleIndex];

    public static bool CanCarryLandIce(PhysicalGeographyField map, int triangleIndex) =>
        map.WaterKindCodes[triangleIndex] is
            PhysicalWaterKindCodes.None or PhysicalWaterKindCodes.Lake;

    public static bool IsGrounded(
        PhysicalGeographyField map,
        int triangleIndex,
        PhysicalGeographyGenerationProfile profile)
    {
        if (map.IceThickness[triangleIndex] <= 0 ||
            map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Ocean)
        {
            return false;
        }

        if (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.None)
        {
            return true;
        }

        var iceHeight = PhysicalElevation.FromUnits(map.IceThickness[triangleIndex] / 3d);
        var submergedDraft = PhysicalElevation.Multiply(
            iceHeight,
            profile.GlacierGroundingFraction,
            1000);
        return submergedDraft >= map.WaterDepths[triangleIndex];
    }

    public static void RefreshGrounding(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            map.GroundedIce[triangleIndex] = IsGrounded(map, triangleIndex, profile) ? 1 : 0;
        }
    }

    public static void RefreshGrounding(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int triangleIndex) =>
        map.GroundedIce[triangleIndex] = IsGrounded(map, triangleIndex, profile) ? 1 : 0;
}
