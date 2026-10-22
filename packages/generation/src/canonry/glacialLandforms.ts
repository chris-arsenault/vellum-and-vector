// GlacialLandformLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { Landform } from "./codes";
import { truncate } from "./math";
import { physicalSampler } from "./physicalMetric";
import { preparePhysicalChannels, physicalFieldReader } from "./continuousState";

function cirqueHead(
  map: PhysicalField,
  i: number,
  threshold: number,
  radius: number,
  valueAt: ReturnType<typeof physicalSampler>
): boolean {
  let highest = -Infinity;
  for (let direction = 0; direction < 16; direction++) {
    const angle = (direction * Math.PI) / 8;
    const value = valueAt(
      map.mesh.x[i] + Math.cos(angle) * radius,
      map.mesh.y[i] + Math.sin(angle) * radius
    );
    if (Number.isFinite(value)) highest = Math.max(highest, value);
  }
  if (!Number.isFinite(highest)) highest = map.MaximumIceThickness[i];
  map.GlacialHeadRelief[i] = map.MaximumIceThickness[i] - highest;
  return map.MaximumIceThickness[i] >= threshold && map.GlacialHeadRelief[i] >= 0;
}
export function glacialLandforms(map: PhysicalField, c: PhysicalContext) {
  map.LandformCodes.fill(0);
  preparePhysicalChannels(map, ["MaximumIceThickness"]);
  const valueAt = physicalFieldReader(map, "MaximumIceThickness");
  for (let i = 0; i < map.mesh.count; i++) {
    map.GlacialFormationDepth[i] = map.WaterDepths[i];
    const head = cirqueHead(
      map,
      i,
      c.Profile.GlacierThicknessThreshold,
      c.Profile.LandformNeighborhoodRadius,
      valueAt
    );
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
    if (head) map.LandformCodes[i] = Landform.Cirque;
    if (
      map.CumulativeDeposition[i] > 0 &&
      map.MaximumGroundedIceFlux[i] >= c.Profile.GlacierFluxThreshold
    )
      map.LandformCodes[i] = Landform.Moraine;
  }
}
