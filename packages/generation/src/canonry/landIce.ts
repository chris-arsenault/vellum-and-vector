// LandIceLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp, round, toUnits, truncate } from "./math";
import { canCarryIce, supportElevation } from "./glacierSurface";

function concavity(map: PhysicalField, i: number): number {
  let total = 0,
    count = 0;
  for (let edge = 0; edge < 3; edge++) {
    const j = map.mesh.neighbors[i * 3 + edge];
    if (j >= 0) {
      total += supportElevation(map, j) - supportElevation(map, i);
      count++;
    }
  }
  return count === 0 ? 0 : toUnits(Math.max(0, truncate(total / count))) * 2;
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
    map.IceThickness[i] =
      balance >= cutoff
        ? clamp(map.IceThickness[i] + growth, p.GlacierThicknessThreshold, 1000)
        : Math.max(0, map.IceThickness[i] - p.IceAblationStep);
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
  for (let edge = 0; edge < 3; edge++) {
    const target = map.mesh.neighbors[source * 3 + edge];
    if (
      target < 0 ||
      map.WaterKindCodes[target] !== 2 ||
      c.GlaciationStrength <= 0 ||
      map.Temperature[target] > p.IceTemperatureThreshold ||
      map.IceBalance[target] < p.MinimumIceBalance
    )
      continue;
    const candidate = Math.max(0, map.IceThickness[source] - p.FrozenLakeIceAdvanceDecay),
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
      map.IceThickness[i] = Math.max(0, map.IceThickness[i] - c.Profile.IceAblationStep);
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
  const balances: number[] = [];
  for (let i = 0; i < map.mesh.count; i++) {
    if (!canCarryIce(map, i)) {
      map.IceThickness[i] = 0;
      continue;
    }
    const balance = massBalance(map, c.Profile, i);
    map.IceBalance[i] = balance;
    if (map.WaterKindCodes[i] === 0 && i < map.mesh.contentCount) balances.push(balance);
  }
  if (balances.length === 0) {
    if (map.OpenBoundary) {
      advanceLakes(map, c);
      return;
    }
    throw new Error("Land-ice generation requires dry land.");
  }
  const count = clamp(
    round(
      (balances.length * c.Profile.QualityTargets.LandIceCoverage.target * c.GlaciationStrength) /
        1000
    ),
    0,
    balances.length
  );
  balances.sort((a, b) => b - a);
  const cutoff =
    count === 0 ? 2147483647 : Math.max(c.Profile.MinimumIceBalance, balances[count - 1]);
  dryLandBalance(map, c, cutoff);
  advanceLakes(map, c);
}
