// LandIceLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp, toUnits, truncate } from "./math";
import { canCarryIce, supportElevation } from "./glacierSurface";

function concavity(map: PhysicalField, i: number): number {
  let curvature = 0;
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const at = i * map.mesh.stride + edge,
      j = map.mesh.neighbors[at];
    if (j >= 0) {
      curvature +=
        (((supportElevation(map, j) - supportElevation(map, i)) / 1024) * map.mesh.faceLength[at]) /
        map.mesh.faceDistance[at];
    }
  }
  return Math.max(0, curvature / map.mesh.areas[i]) * 50_000_000;
}
function massBalance(map: PhysicalField, p: PhysicalProfile, i: number): number {
  const cold = Math.max(0, p.IceTemperatureThreshold - map.Temperature[i]);
  const snow = truncate((map.Snowfall[i] * cold) / 300);
  const altitude = truncate(
    toUnits(Math.max(0, supportElevation(map, i) - map.EffectiveSeaLevel)) / 4
  );
  const warm = Math.max(0, map.Temperature[i] - p.IceTemperatureThreshold) * 4;
  return (
    cold * 2 +
    snow +
    altitude +
    concavity(map, i) -
    warm -
    truncate(map.Geothermal[i] / 3) -
    Math.max(0, 280 - map.Moisture[i])
  );
}
function dryLandBalance(map: PhysicalField, c: PhysicalContext, cutoff: number) {
  const p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 0) continue;
    const balance = map.IceBalance[i];
    const growth = truncate(
      (Math.min(p.IceAccumulationStep, p.GlacierThicknessThreshold + (balance - cutoff) * 2) *
        c.GlaciationStrength) /
        1000
    );
    const sustained = balance >= cutoff && (map.IceThickness[i] > 0 || growth > 0);
    map.IceThickness[i] = sustained
      ? clamp(map.IceThickness[i] + growth, p.GlacierThicknessThreshold, 1000)
      : balance >= cutoff
        ? 0
        : // Melting scales with the deficit, so warm climates clear relict ice quickly.
          // Stored magical charge holds a thick field still against a marginal deficit; it
          // cannot keep a glacier in a warm lowland, and a thinning skin of ice goes with
          // the climate.
          Math.max(
            0,
            map.IceThickness[i] -
              Math.max(p.IceAblationStep, cutoff - balance) *
                (1 -
                  map.IcePersistence[i] *
                    Math.max(0, 1 - (cutoff - balance) / 600) *
                    clamp((map.IceThickness[i] - 150) / 150, 0, 1))
          );
    map.MaximumIceThickness[i] = Math.max(map.MaximumIceThickness[i], map.IceThickness[i]);
  }
}
function advanceFrom(
  map: PhysicalField,
  c: PhysicalContext,
  source: number,
  reached: Uint8Array,
  queue: number[]
) {
  const p = c.Profile;
  for (let edge = 0; edge < map.mesh.degree[source]; edge++) {
    const target = map.mesh.neighbors[source * map.mesh.stride + edge];
    if (
      target < 0 ||
      map.WaterKindCodes[target] !== 2 ||
      c.GlaciationStrength <= 0 ||
      map.Temperature[target] > p.IceTemperatureThreshold ||
      map.IceBalance[target] < p.MinimumIceBalance
    )
      continue;
    const candidate = Math.max(
        0,
        map.IceThickness[source] -
          p.FrozenLakeIceAdvanceGradient * map.mesh.edgeLength[source * map.mesh.stride + edge]
      ),
      improved = candidate > map.IceThickness[target];
    if (improved) map.IceThickness[target] = candidate;
    if (!reached[target] || improved) {
      reached[target] = 1;
      queue.push(target);
    }
  }
}
function advanceLakes(map: PhysicalField, c: PhysicalContext) {
  const reached = new Uint8Array(map.mesh.count),
    queue: number[] = [];
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] === 2)
      map.IceThickness[i] = Math.max(
        0,
        map.IceThickness[i] - c.Profile.IceAblationStep * (1 - map.IcePersistence[i])
      );
    else if (map.WaterKindCodes[i] === 0 && map.IceThickness[i] > 0) {
      reached[i] = 1;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) advanceFrom(map, c, queue[head], reached, queue);
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes[i] === 2)
      map.MaximumIceThickness[i] = Math.max(map.MaximumIceThickness[i], map.IceThickness[i]);
}
export function landIce(map: PhysicalField, c: PhysicalContext) {
  map.IceBalance.fill(0);
  let land = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (!canCarryIce(map, i)) {
      map.IceThickness[i] = 0;
      continue;
    }
    map.IceBalance[i] = massBalance(map, c.Profile, i);
    if (map.WaterKindCodes[i] === 0 && map.mesh.contentAreas[i] > 0) land++;
  }
  if (land === 0) {
    advanceLakes(map, c);
    return;
  }
  // Positive mass balance sustains ice and extent follows climate rather than
  // a requested coverage. Epoch glaciation scales only how fast ice grows.
  dryLandBalance(map, c, c.Profile.MinimumIceBalance);
  advanceLakes(map, c);
}
