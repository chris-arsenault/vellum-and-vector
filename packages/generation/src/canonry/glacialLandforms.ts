// GlacialLandformLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { Landform } from "./codes";
import { truncate } from "./math";
import { physicalSampler } from "./physicalMetric";

function cirqueHead(
  map: PhysicalField,
  i: number,
  threshold: number,
  radius: number,
  valueAt: ReturnType<typeof physicalSampler>
): boolean {
  if (map.MaximumIceThickness[i] < threshold) return false;
  for (let direction = 0; direction < 16; direction++) {
    const angle = (direction * Math.PI) / 8;
    if (
      valueAt(map.mesh.x[i] + Math.cos(angle) * radius, map.mesh.y[i] + Math.sin(angle) * radius) >
      map.MaximumIceThickness[i]
    )
      return false;
  }
  return true;
}
export function glacialLandforms(map: PhysicalField, c: PhysicalContext) {
  map.LandformCodes.fill(0);
  const valueAt = physicalSampler(map.mesh, map.MaximumIceThickness);
  for (let i = 0; i < map.mesh.count; i++) {
    if (
      map.WaterKindCodes[i] !== 0 ||
      map.MaximumGroundedIceFlux[i] < c.Profile.GlacierFluxThreshold
    )
      continue;
    if (
      map.CumulativeGlacialErosion[i] > 0 &&
      (map.RiverOrders[i] > 0 ||
        map.FlowAccumulation[i] >= truncate(c.Profile.RiverAccumulationThreshold / 2))
    )
      map.LandformCodes[i] = Landform.UValley;
    if (
      cirqueHead(
        map,
        i,
        c.Profile.GlacierThicknessThreshold,
        c.Profile.LandformNeighborhoodRadius,
        valueAt
      )
    )
      map.LandformCodes[i] = Landform.Cirque;
    if (
      map.CumulativeDeposition[i] > 0 &&
      map.MaximumGroundedIceFlux[i] >= c.Profile.GlacierFluxThreshold
    )
      map.LandformCodes[i] = Landform.Moraine;
  }
}
