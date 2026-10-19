// DeltaFormationLayer.cs, Canonry 0f62584c. Float32 intermediates match the reference fan geometry.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp } from "./math";
import { sourceToOutletOrder } from "./flowGraph";

function sedimentDelivery(map: PhysicalField): Float64Array {
  const delivery = Float64Array.from(
    { length: map.mesh.count },
    (_, i) =>
      ((map.CumulativeFluvialErosion[i] + map.CumulativeGlacialErosion[i]) / 1024) *
      map.mesh.areas[i]
  );
  for (const i of sourceToOutletOrder(map)) {
    const target = map.FlowTargets[i];
    if (target >= 0) delivery[target] += delivery[i];
  }
  return delivery;
}
function qualifies(
  map: PhysicalField,
  c: PhysicalContext,
  delivery: Float64Array,
  mouth: number,
  ocean: number
): boolean {
  const p = c.Profile;
  const major =
    map.RiverOrders[mouth] >= p.DeltaMinimumRiverOrder ||
    map.FlowAccumulation[mouth] >= p.RiverAccumulationThreshold * p.DeltaDischargeMultiplier;
  return (
    major &&
    delivery[mouth] >= p.DeltaMinimumSedimentDelivery &&
    map.WaveExposure[ocean] <= p.DeltaMaximumWaveEnergy &&
    map.OceanCurrentStrength[ocean] <= p.DeltaMaximumCurrentStrength &&
    map.BathymetricZoneCodes[ocean] !== 4
  );
}
function markDelta(map: PhysicalField, i: number, intensity: number, order: number) {
  map.DeltaIntensity[i] = clamp(intensity, 1, 1000);
  map.RiverChannelStrength[i] = Math.max(map.RiverChannelStrength[i], map.DeltaIntensity[i]);
  map.RiverChannelOrders[i] = Math.max(map.RiverChannelOrders[i], order);
  map.FloodplainIntensity[i] = 0;
}
function receiveDelta(map: PhysicalField, mouth: number, i: number): boolean {
  if (map.WaterKindCodes[i] === 2) return false;
  return map.WaterKindCodes[i] === 1
    ? map.BathymetricZoneCodes[i] !== 4
    : map.DrainageBasinIds[i] === map.DrainageBasinIds[mouth];
}
function stepDirection(
  map: PhysicalField,
  source: number,
  target: number
): [number, number, number] {
  const f = Math.fround,
    x = f(map.mesh.x[target] - map.mesh.x[source]),
    y = f(map.mesh.y[target] - map.mesh.y[source]);
  const length = Math.max(f(0.001), f(Math.sqrt(f(f(x * x) + f(y * y)))));
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
  const order = map.RiverOrders[mouth],
    queue = [{ i: ocean, depth: map.mesh.spacing, previous: mouth }],
    p = c.Profile;
  markDelta(map, mouth, 1000, order);
  for (let head = 0; head < queue.length; head++) {
    const front = queue[head];
    if (front.depth > p.DeltaMaximumRadius || !receiveDelta(map, mouth, front.i)) continue;
    const intensity = 1000 - (front.depth / 10_000) * p.DeltaIntensityDecay;
    if (intensity <= map.DeltaIntensity[front.i]) continue;
    markDelta(map, front.i, intensity, order);
    if (front.depth >= p.DeltaMaximumRadius) continue;
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[front.i * 3 + edge];
      if (
        j < 0 ||
        j === front.previous ||
        !pointsIntoFan(map, front.i, j, dx, dy, p.DeltaMinimumForwardAlignment)
      )
        continue;
      queue.push({ i: j, depth: front.depth + map.mesh.spacing, previous: front.i });
    }
  }
}
export function deltaFormation(map: PhysicalField, c: PhysicalContext) {
  map.DeltaIntensity.fill(0);
  const delivery = sedimentDelivery(map);
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.RiverOrders[i] <= 0) continue;
    const ocean = map.FlowTargets[i];
    if (ocean >= 0 && map.WaterKindCodes[ocean] === 1 && qualifies(map, c, delivery, i, ocean))
      buildFan(map, c, i, ocean);
  }
}
