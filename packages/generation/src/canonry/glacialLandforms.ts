// GlacialLandformLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { Landform } from "./codes";
import { truncate, units } from "./math";
import { physicalSampler } from "./physicalMetric";

function cirqueHead(
  map: PhysicalField,
  i: number,
  threshold: number,
  radius: number,
  valueAt: ReturnType<typeof physicalSampler>
): boolean {
  const thickness = map.MaximumIceThickness.get(i);
  if (thickness < threshold) return false;
  // Strictly thicker than all around: a level ice-sheet plateau has no cirque heads.
  const x = map.mesh.x(i),
    y = map.mesh.y(i);
  for (let direction = 0; direction < 16; direction++) {
    const angle = (direction * Math.PI) / 8;
    if (valueAt(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius) >= thickness)
      return false;
  }
  return true;
}
export function glacialLandforms(map: PhysicalField, c: PhysicalContext) {
  map.LandformCodes.fill(0);
  const valueAt = physicalSampler(map.mesh, map.MaximumIceThickness);
  for (let i = 0; i < map.mesh.count; i++) {
    if (
      map.WaterKindCodes.get(i) !== 0 ||
      map.MaximumGroundedIceFlux.get(i) < c.Profile.GlacierFluxThreshold
    )
      continue;
    if (
      map.CumulativeGlacialErosion.get(i) >= units(c.Profile.UValleyMinimumGlacialErosion) &&
      (map.RiverOrders.get(i) > 0 ||
        map.FlowAccumulation.get(i) >= truncate(c.Profile.RiverAccumulationThreshold / 2))
    )
      map.LandformCodes.set(i, Landform.UValley);
    // Cirques are mountain landforms: bowls at the heads of valley glaciers.
    if (
      map.Elevation.get(i) - map.EffectiveSeaLevel >= units(c.Profile.MountainElevation) &&
      cirqueHead(
        map,
        i,
        c.Profile.GlacierThicknessThreshold,
        c.Profile.LandformNeighborhoodRadius,
        valueAt
      )
    )
      map.LandformCodes.set(i, Landform.Cirque);
    // Moraines are till ridges left where ice termini stood: glacial deposition only, not the
    // river and slope deposition that covers most formerly glaciated land.
    if (map.CumulativeGlacialDeposition.get(i) >= units(c.Profile.MoraineMinimumGlacialDeposition))
      map.LandformCodes.set(i, Landform.Moraine);
  }
}
