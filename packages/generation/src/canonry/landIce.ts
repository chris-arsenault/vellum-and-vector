// LandIceLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp, toUnits, truncate } from "./math";
import { canCarryIce, supportElevation } from "./glacierSurface";
import { CellQueue, type Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";

function concavity(map: PhysicalField, i: number): number {
  let curvature = 0;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j >= 0) {
      curvature +=
        (((supportElevation(map, j) - supportElevation(map, i)) / 1024) *
          map.mesh.faceLength(i, edge)) /
        map.mesh.faceDistance(i, edge);
    }
  }
  return Math.max(0, curvature / map.mesh.area(i)) * 50_000_000;
}
function massBalance(map: PhysicalField, p: PhysicalProfile, i: number): number {
  const cold = Math.max(0, p.IceTemperatureThreshold - map.Temperature.get(i));
  const snow = truncate((map.Snowfall.get(i) * cold) / 300);
  const altitude = truncate(
    toUnits(Math.max(0, supportElevation(map, i) - map.EffectiveSeaLevel)) * p.IceAltitudeBalance
  );
  const warm = Math.max(0, map.Temperature.get(i) - p.IceTemperatureThreshold) * 4;
  return (
    cold * 2 +
    snow +
    altitude +
    concavity(map, i) -
    warm -
    truncate(map.Geothermal.get(i) / 3) -
    Math.max(0, 280 - map.Moisture.get(i))
  );
}
function dryLandBalance(map: PhysicalField, c: PhysicalContext, cutoff: number) {
  const p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 0) continue;
    const balance = map.IceBalance.get(i),
      thickness = map.IceThickness.get(i);
    const growth = truncate(
      (Math.min(p.IceAccumulationStep, p.GlacierThicknessThreshold + (balance - cutoff) * 2) *
        c.GlaciationStrength) /
        1000
    );
    const sustained = balance >= cutoff && (thickness > 0 || growth > 0);
    map.IceThickness.set(
      i,
      sustained
        ? clamp(thickness + growth, p.GlacierThicknessThreshold, 1000)
        : balance >= cutoff
          ? 0
          : // Melting scales with the deficit, so warm climates clear relict ice quickly.
            // Stored magical charge holds a thick field still against a marginal deficit; it
            // cannot keep a glacier in a warm lowland, and a thinning skin of ice goes with
            // the climate.
            Math.max(
              0,
              thickness -
                Math.max(p.IceAblationStep, cutoff - balance) *
                  (1 -
                    map.IcePersistence.get(i) *
                      Math.max(0, 1 - (cutoff - balance) / 600) *
                      clamp((thickness - 150) / 150, 0, 1))
            )
    );
    map.MaximumIceThickness.set(
      i,
      Math.max(map.MaximumIceThickness.get(i), map.IceThickness.get(i))
    );
  }
}
function advanceFrom(
  map: PhysicalField,
  c: PhysicalContext,
  source: number,
  reached: Band,
  queue: CellQueue
) {
  const p = c.Profile;
  for (let edge = 0; edge < map.mesh.degree(source); edge++) {
    const target = map.mesh.neighbor(source, edge);
    if (
      target < 0 ||
      map.WaterKindCodes.get(target) !== 2 ||
      c.GlaciationStrength <= 0 ||
      map.Temperature.get(target) > p.IceTemperatureThreshold ||
      map.IceBalance.get(target) < p.MinimumIceBalance
    )
      continue;
    const candidate = Math.max(
        0,
        map.IceThickness.get(source) -
          p.FrozenLakeIceAdvanceGradient * map.mesh.edgeLength(source, edge)
      ),
      improved = candidate > map.IceThickness.get(target);
    if (improved) map.IceThickness.set(target, candidate);
    if (!reached.get(target) || improved) {
      reached.set(target, 1);
      queue.push(target);
    }
  }
}
function advanceLakes(map: PhysicalField, c: PhysicalContext) {
  const reached = workingArray(map, "uint8", "ice:reached"),
    queue = new CellQueue();
  for (let i = 0; i < map.mesh.count; i++) {
    const water = map.WaterKindCodes.get(i);
    if (water === 2)
      map.IceThickness.set(
        i,
        Math.max(
          0,
          map.IceThickness.get(i) - c.Profile.IceAblationStep * (1 - map.IcePersistence.get(i))
        )
      );
    else if (water === 0 && map.IceThickness.get(i) > 0) {
      reached.set(i, 1);
      queue.push(i);
    }
  }
  for (let i = queue.shift(); i >= 0; i = queue.shift()) advanceFrom(map, c, i, reached, queue);
  releaseWorking(map, reached);
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes.get(i) === 2)
      map.MaximumIceThickness.set(
        i,
        Math.max(map.MaximumIceThickness.get(i), map.IceThickness.get(i))
      );
}
export function landIce(map: PhysicalField, c: PhysicalContext) {
  map.IceBalance.fill(0);
  let land = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (!canCarryIce(map, i)) {
      map.IceThickness.set(i, 0);
      continue;
    }
    map.IceBalance.set(i, massBalance(map, c.Profile, i));
    if (map.WaterKindCodes.get(i) === 0 && map.mesh.membership(i) === 1) land++;
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
