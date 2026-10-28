import { CellQueue, FloatList, type Band } from "@atlas/domain";
import type { PhysicalField } from "./field";
import { clamp } from "./math";
import { physicalFace, cellTravel } from "./physicalMetric";
import { workingArray, releaseWorking } from "./physicalNumerics";

export interface CoastalFrame {
  strength: Band;
  coverage: Band;
  source: Band;
}
function seedShores(map: PhysicalField, forcing?: Band) {
  const columns = Array.from({ length: 7 }, () => new FloatList());
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 0) continue;
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j < 0 || map.WaterKindCodes.get(j) !== 1) continue;
      const strength = forcing ? forcing.get(i) : map.WaveExposure.get(j);
      if (strength <= 0) continue;
      const { x, y, nx, ny, length } = physicalFace(map.mesh, i, edge);
      [x, y, nx, ny, length, strength, i].forEach((v, at) => columns[at].push(v));
    }
  }
  const [x, y, nx, ny, length, strength, seeds] = columns.map((column) => column.finish());
  return { x, y, nx, ny, length, strength, seeds };
}
function shoreDistance(
  shores: ReturnType<typeof seedShores>,
  source: number,
  x: number,
  y: number
) {
  const dx = x - shores.x[source],
    dy = y - shores.y[source],
    nx = shores.nx[source],
    ny = shores.ny[source],
    length = shores.length[source];
  const along = clamp(dx * -ny + dy * nx, -length / 2, length / 2);
  return Math.hypot(dx + ny * along, dy - nx * along);
}
/** Fractional cell coverage of a physical shore band, including unresolved strips. */
export function coastalFrame(map: PhysicalField, width: number, forcing?: Band): CoastalFrame {
  const shores = seedShores(map, forcing),
    nearest = workingArray(map, "int32", "coast:nearest").fill(-1),
    distance = workingArray(map, "float64", "coast:distance").fill(Infinity),
    queue = new CellQueue();
  const offer = (i: number, source: number) => {
    const d = shoreDistance(shores, source, map.mesh.x(i), map.mesh.y(i)),
      span = cellTravel(map.mesh, i, shores.nx[source], shores.ny[source]),
      held = distance.get(i);
    if (d > width + span / 2 || d > held) return;
    const at = nearest.get(i);
    if (d === held && at >= 0 && shores.strength[source] <= shores.strength[at]) return;
    distance.set(i, d);
    nearest.set(i, source);
    queue.push(i);
  };
  shores.seeds.forEach((i, source) => offer(i, source));
  for (let i = queue.shift(); i >= 0; i = queue.shift()) {
    const at = nearest.get(i);
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j >= 0 && map.WaterKindCodes.get(j) === 0) offer(j, at);
    }
  }
  const strength = workingArray(map, "int32", "coast:strength"),
    coverage = workingArray(map, "float64", "coast:coverage"),
    source = workingArray(map, "int32", "coast:source").fill(-1);
  for (let i = 0; i < map.mesh.count; i++) {
    const at = nearest.get(i);
    if (at < 0) continue;
    const span = cellTravel(map.mesh, i, shores.nx[at], shores.ny[at]);
    coverage.set(i, clamp((width - distance.get(i)) / span + 0.5, 0, 1));
    strength.set(i, shores.strength[at]);
    source.set(i, shores.seeds[at]);
  }
  releaseWorking(map, nearest, distance);
  return { strength, coverage, source };
}
