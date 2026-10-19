import { visitAdaptiveOverlap } from "@atlas/domain";
import type { PhysicalField } from "./field";
import type { MagicField } from "./magicState";
import { nearestTriangle } from "./mesh";
import { hashSigned, hashUnit } from "./noise";

function kernelWeight(map: PhysicalField, i: number, x: number, y: number, radius: number) {
  const mesh = map.mesh;
  const x0 = Math.max(mesh.x[i] - mesh.cellWidth[i] / 2, x - radius);
  const x1 = Math.min(mesh.x[i] + mesh.cellWidth[i] / 2, x + radius);
  const y0 = Math.max(mesh.y[i] - mesh.cellHeight[i] / 2, y - radius);
  const y1 = Math.min(mesh.y[i] + mesh.cellHeight[i] / 2, y + radius);
  if (x1 <= x0 || y1 <= y0) return 0;
  let weight = 0;
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 3; b++)
      weight += Math.max(
        0,
        1 -
          Math.hypot(x0 + ((a + 0.5) * (x1 - x0)) / 3 - x, y0 + ((b + 0.5) * (y1 - y0)) / 3 - y) /
            radius
      );
  return (weight / 9) * (x1 - x0) * (y1 - y0);
}
function beamCells(map: PhysicalField, x: number, y: number, radius: number) {
  const mesh = map.mesh,
    cells: number[] = [];
  if (mesh.topology) {
    visitAdaptiveOverlap(
      mesh.topology,
      [
        x + mesh.origin[0] - radius,
        y + mesh.origin[1] - radius,
        x + mesh.origin[0] + radius,
        y + mesh.origin[1] + radius,
      ],
      (leaf) => cells.push(mesh.leafToCell[leaf])
    );
    return cells;
  }
  const start = nearestTriangle(mesh, x, y),
    queue = [start],
    visited = new Set(queue);
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    if (
      i < 0 ||
      Math.hypot(mesh.x[i] - x, mesh.y[i] - y) >
        radius + Math.hypot(mesh.cellWidth[i], mesh.cellHeight[i])
    )
      continue;
    cells.push(i);
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const j = mesh.neighbors[i * mesh.stride + edge];
      if (j < 0 || visited.has(j)) continue;
      visited.add(j);
      queue.push(j);
    }
  }
  return cells;
}
function paintBeam(
  map: PhysicalField,
  field: MagicField,
  x: number,
  y: number,
  amount: number,
  distance: number,
  wake: boolean
) {
  const radius = field.definition.parameters.beamWidth / 2;
  const cells = beamCells(map, x, y, radius).filter((i) => map.WaterKindCodes[i] === 1);
  const weights = cells.map((i) => kernelWeight(map, i, x, y, radius));
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!total) return;
  const volume = amount * radius * 2 * distance;
  cells.forEach((i, index) => {
    field.intensity[i] = Math.min(
      1000,
      field.intensity[i] + (volume * weights[index]) / total / map.mesh.areas[i]
    );
    if (wake && weights[index] > 0) field.wake[i] = 1;
  });
}
/** Integrate physical rays; headings never snap to sampling-cell neighbors. */
export function traceOceanBeam(
  map: PhysicalField,
  field: MagicField,
  seed: number,
  source: number,
  angle: number,
  energy: number,
  reach: number,
  wake = false
) {
  let x = map.mesh.x[source],
    y = map.mesh.y[source],
    bounces = 0;
  const step = field.definition.parameters.beamWidth / 2;
  for (let distance = 0; distance < reach && energy > 0;) {
    const travel = Math.min(step, reach - distance);
    // A source station has a beam-width footprint, even when its ray terminates there.
    paintBeam(map, field, x, y, wake ? energy : energy / 36, Math.max(travel, step), wake);
    const nx = x + Math.cos(angle) * travel,
      ny = y + Math.sin(angle) * travel;
    const next = nearestTriangle(map.mesh, nx, ny);
    if (next < 0 || map.WaterKindCodes[next] !== 1) {
      if (wake || ++bounces > 4) break;
      angle += Math.PI * (0.58 + hashUnit(seed, Math.floor(x / 10_000), bounces) * 0.62);
      energy -= 90;
    } else {
      x = nx;
      y = ny;
      if (wake)
        angle +=
          (hashSigned(seed, Math.floor(distance / 10_000), Math.floor(x / 10_000)) *
            0.16 *
            travel) /
          10_000;
      else energy -= ((3 + 2 * bounces) * travel) / 10_000;
    }
    distance += travel;
  }
}
