import { meshDeltaX } from "./mesh";
// DeltaFormationLayer.cs, Canonry 0f62584c. Float32 intermediates match the reference fan geometry.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp } from "./math";
import { gatherDown, sourceToOutletOrder } from "./flowGraph";
import { physicalDistance } from "./physicalMetric";
import { workingValues, releaseWorking } from "./physicalNumerics";
import { onRiver, riverOrderAt } from "../water/riverKeeping";
import { MapScale, type Band } from "@atlas/domain";

function sedimentDelivery(map: PhysicalField): Band {
  const delivery = workingValues(
    map,
    "float64",
    "delta:delivery",
    (i) =>
      MapScale.metres(
        map.CumulativeFluvialErosion.get(i) + map.CumulativeGlacialErosion.get(i),
        "native"
      ) * map.mesh.area(i)
  );
  const order = sourceToOutletOrder(map);
  gatherDown(order, map.FlowTargets, delivery);
  releaseWorking(map, order);
  return delivery;
}
function qualifies(
  map: PhysicalField,
  c: PhysicalContext,
  delivery: Band,
  mouth: number,
  ocean: number
): boolean {
  const p = c.Profile;
  const major =
    riverOrderAt(map, mouth) >= p.DeltaMinimumRiverOrder ||
    map.FlowAccumulation.get(mouth) >= p.RiverAccumulationThreshold * p.DeltaDischargeMultiplier;
  return (
    major &&
    delivery.get(mouth) >= p.DeltaMinimumSedimentDelivery &&
    map.WaveExposure.get(ocean) <= p.DeltaMaximumWaveEnergy &&
    map.OceanCurrentStrength.get(ocean) <= p.DeltaMaximumCurrentStrength &&
    map.BathymetricZoneCodes.get(ocean) !== 4
  );
}
function markDelta(intensities: Band, i: number, intensity: number) {
  // A submerged sediment fan is a delta, not an unrouted river channel.
  intensities.set(i, clamp(intensity, 1, 1000));
}
function receiveDelta(map: PhysicalField, mouth: number, i: number): boolean {
  const water = map.WaterKindCodes.get(i);
  if (water === 2) return false;
  return water === 1
    ? map.BathymetricZoneCodes.get(i) !== 4
    : map.DrainageBasinIds.get(i) === map.DrainageBasinIds.get(mouth);
}
function stepDirection(
  map: PhysicalField,
  source: number,
  target: number
): [number, number, number] {
  const f = Math.fround,
    x = f(meshDeltaX(map.mesh, map.mesh.x(target) - map.mesh.x(source))),
    y = f(map.mesh.y(target) - map.mesh.y(source));
  const length = f(Math.sqrt(f(f(x * x) + f(y * y)))) || 1;
  return [x, y, length];
}
function pointsIntoFan(
  map: PhysicalField,
  source: number,
  target: number,
  dx: number,
  dy: number,
  minimum: number
): boolean {
  const f = Math.fround,
    [x, y, length] = stepDirection(map, source, target);
  return f(f(f(x * dx) + f(y * dy)) / length) >= f(minimum / 1000);
}
function buildFan(map: PhysicalField, c: PhysicalContext, mouth: number, ocean: number) {
  const f = Math.fround,
    [x, y, length] = stepDirection(map, mouth, ocean),
    dx = f(x / length),
    dy = f(y / length);
  const queue = [{ i: ocean, depth: physicalDistance(map.mesh, mouth, ocean), previous: mouth }],
    p = c.Profile;
  markDelta(map.DeltaIntensity, mouth, 1000);
  for (let head = 0; head < queue.length; head++) {
    const front = queue[head];
    if (!receiveDelta(map, mouth, front.i)) continue;
    const intensity = 1000 - (front.depth / map.scale.length(0.0025)) * p.DeltaIntensityDecay;
    if (intensity <= map.DeltaIntensity.get(front.i)) continue;
    markDelta(map.DeltaIntensity, front.i, intensity);
    for (let edge = 0; edge < map.mesh.degree(front.i); edge++) {
      const j = map.mesh.neighbor(front.i, edge);
      if (
        j < 0 ||
        j === front.previous ||
        !pointsIntoFan(map, front.i, j, dx, dy, p.DeltaMinimumForwardAlignment)
      )
        continue;
      queue.push({
        i: j,
        depth: front.depth + physicalDistance(map.mesh, front.i, j),
        previous: front.i,
      });
    }
  }
}
export function deltaFormation(map: PhysicalField, c: PhysicalContext) {
  map.DeltaIntensity.fill(0);
  const delivery = sedimentDelivery(map);
  for (let i = 0; i < map.mesh.count; i++) {
    if (!onRiver(map, i)) continue;
    const ocean = map.FlowTargets.get(i);
    if (ocean >= 0 && map.WaterKindCodes.get(ocean) === 1 && qualifies(map, c, delivery, i, ocean))
      buildFan(map, c, i, ocean);
  }
  releaseWorking(map, delivery);
}
