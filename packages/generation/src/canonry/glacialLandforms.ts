// GlacialLandformLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { Landform } from "./codes";
import { truncate } from "./math";

function cirqueHead(map: PhysicalField, i: number, threshold: number): boolean {
  if (map.MaximumIceThickness[i] < threshold) return false;
  for (let edge = 0; edge < 3; edge++) {
    const j = map.mesh.neighbors[i * 3 + edge];
    if (j >= 0 && map.MaximumIceThickness[j] > map.MaximumIceThickness[i]) return false;
  }
  return true;
}
export function glacialLandforms(map: PhysicalField, c: PhysicalContext) {
  map.LandformCodes.fill(0);
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
    if (cirqueHead(map, i, c.Profile.GlacierThicknessThreshold))
      map.LandformCodes[i] = Landform.Cirque;
    if (
      map.CumulativeDeposition[i] > 0 &&
      map.MaximumGroundedIceFlux[i] >= c.Profile.GlacierFluxThreshold
    )
      map.LandformCodes[i] = Landform.Moraine;
  }
}
