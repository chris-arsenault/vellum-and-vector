import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import type { RiverPaths } from "./riverPaths";
import { nearestTriangle } from "./mesh";

export function admitRiverPoint(
  work: AtlasPhysicalWorkspace,
  source: number,
  proposed: [number, number],
  original: [number, number]
): [number, number] {
  const map = work.map;
  let point = proposed;
  for (let attempt = 0; attempt < 8; attempt++) {
    const cell = nearestTriangle(map.mesh, ...point);
    if (
      cell >= 0 &&
      !map.WaterKindCodes[cell] &&
      map.DrainageBasinIds[cell] === map.DrainageBasinIds[source]
    )
      return point;
    point = [(point[0] + original[0]) / 2, (point[1] + original[1]) / 2];
  }
  return original;
}

/** Compose dominant stems before tributaries, so confluences follow the whole river. */
export function composeRiverStems(work: AtlasPhysicalWorkspace, paths: RiverPaths) {
  const map = work.map,
    mesh = map.mesh,
    assigned = new Uint8Array(mesh.count),
    seeds = Array.from({ length: mesh.count }, (_, i) => i)
      .filter((i) => map.RiverOrders[i] > 0)
      .sort((a, b) => map.FlowAccumulation[b] - map.FlowAccumulation[a] || a - b);
  for (const seed of seeds) {
    if (assigned[seed]) continue;
    const cells = [seed];
    while (paths.upstream[cells.at(-1)!] >= 0) {
      const next = paths.upstream[cells.at(-1)!];
      if (assigned[next]) break;
      cells.push(next);
    }
    cells.reverse();
    const target = map.FlowTargets[seed];
    if (target >= 0) cells.push(target);
    const distance = [0];
    for (let n = 1; n < cells.length; n++)
      distance.push(
        distance[n - 1] +
          Math.hypot(
            paths.x[cells[n]] - paths.x[cells[n - 1]],
            paths.y[cells[n]] - paths.y[cells[n - 1]]
          )
      );
    const radius = Math.max(map.RiverWidth[seed] * 32, Math.min(120_000, distance.at(-1)! * 0.18)),
      points = cells.map((i, n) => smoothedStation(work, paths, cells, distance, n, radius));
    for (let n = 0; n < cells.length; n++) {
      const i = cells[n];
      if (assigned[i] || map.WaterKindCodes[i]) continue;
      paths.x[i] = points[n][0];
      paths.y[i] = points[n][1];
      assigned[i] = 1;
    }
  }
}
function smoothedStation(
  work: AtlasPhysicalWorkspace,
  paths: RiverPaths,
  cells: number[],
  distances: number[],
  n: number,
  radius: number
): [number, number] {
  const i = cells[n],
    original: [number, number] = [paths.x[i], paths.y[i]];
  if (n === 0 || n === cells.length - 1) return original;
  let x = 0,
    y = 0,
    total = 0;
  for (let j = 0; j < cells.length; j++) {
    const relative = Math.abs(distances[n] - distances[j]) / radius;
    if (relative >= 1) continue;
    const weight = (1 - relative * relative) ** 2;
    x += paths.x[cells[j]] * weight;
    y += paths.y[cells[j]] * weight;
    total += weight;
  }
  return admitRiverPoint(work, i, [x / total, y / total], original);
}
