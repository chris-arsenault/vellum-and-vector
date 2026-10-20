import type { PhysicalMesh } from "./mesh";
import { PriorityQueue } from "./priorityQueue";

/** Curved, branching axes inside a connected physical region. Construction scratch only. */
export function regionSpines(mesh: PhysicalMesh, cells: number[], branchWidth: number) {
  if (!cells.length) return [];
  const members = new Set(cells),
    first = distances(mesh, members, [cells[0]]),
    a = farthest(cells, first.distance),
    second = distances(mesh, members, [a]),
    trunk = trace(farthest(cells, second.distance), second.parent),
    paths = [trunk],
    included = new Set(trunk);
  for (;;) {
    const nearby = distances(mesh, members, included),
      tip = farthest(cells, nearby.distance);
    if (nearby.distance.get(tip)! <= branchWidth) break;
    const branch = trace(tip, nearby.parent);
    for (const i of branch) included.add(i);
    paths.push(branch.reverse());
  }
  return paths;
}
function distances(mesh: PhysicalMesh, members: Set<number>, seeds: Iterable<number>) {
  const distance = new Map<number, number>(),
    parent = new Map<number, number>(),
    queue = new PriorityQueue<{ i: number; distance: number }>(
      (a, b) => a.distance - b.distance || a.i - b.i
    );
  for (const i of seeds) {
    distance.set(i, 0);
    queue.push({ i, distance: 0 });
  }
  while (queue.count) {
    const current = queue.pop();
    if (current.distance !== distance.get(current.i)) continue;
    for (let edge = 0; edge < mesh.degree[current.i]; edge++) {
      const at = current.i * mesh.stride + edge,
        j = mesh.neighbors[at];
      if (!members.has(j)) continue;
      const next = current.distance + mesh.edgeLength[at];
      if (next >= (distance.get(j) ?? Infinity)) continue;
      distance.set(j, next);
      parent.set(j, current.i);
      queue.push({ i: j, distance: next });
    }
  }
  return { distance, parent };
}
function farthest(cells: number[], distance: Map<number, number>) {
  return cells.reduce((a, b) => ((distance.get(a) ?? 0) >= (distance.get(b) ?? 0) ? a : b));
}
function trace(tip: number, parent: Map<number, number>) {
  const path = [tip];
  while (parent.has(path.at(-1)!)) path.push(parent.get(path.at(-1)!)!);
  return path;
}

/** Assign each region cell to its nearest branch station without a global PCA axis. */
export function branchingSections(mesh: PhysicalMesh, cells: number[], length: number) {
  const paths = regionSpines(mesh, cells, length * 1.5),
    stations = paths.map((path) =>
      path.filter(
        (_, i) =>
          i === 0 ||
          i === path.length - 1 ||
          i % Math.max(1, Math.round(length / mesh.spacing)) === 0
      )
    ),
    owner = new Map<number, number>(),
    all = stations.flat();
  all.forEach((cell, index) => {
    if (!owner.has(cell)) owner.set(cell, index);
  });
  const nearby = distances(mesh, new Set(cells), owner.keys());
  for (const i of cells) {
    if (owner.has(i)) continue;
    const path: number[] = [];
    let next = i;
    while (!owner.has(next) && nearby.parent.has(next)) {
      path.push(next);
      next = nearby.parent.get(next)!;
    }
    for (const cell of path) owner.set(cell, owner.get(next)!);
  }
  const shared = new Map<number, { cells: number[]; point: [number, number]; width: number }>(),
    sections = all.map((i) => {
      if (!shared.has(i))
        shared.set(i, {
          cells: [],
          point: [mesh.x[i] + mesh.origin[0], mesh.y[i] + mesh.origin[1]],
          width: length * 0.4,
        });
      return shared.get(i)!;
    });
  for (const i of cells) {
    const section = sections[owner.get(i)!];
    section.cells.push(i);
    section.width = Math.max(section.width, nearby.distance.get(i) ?? 0);
  }
  for (const [station, section] of shared) {
    if (!section.cells.length) section.cells.push(station);
    const area = section.cells.reduce((sum, i) => sum + mesh.areas[i], 0);
    section.point = [
      section.cells.reduce((sum, i) => sum + mesh.x[i] * mesh.areas[i], 0) / area + mesh.origin[0],
      section.cells.reduce((sum, i) => sum + mesh.y[i] * mesh.areas[i], 0) / area + mesh.origin[1],
    ];
  }
  let offset = 0;
  return stations
    .map((path) => {
      const branch = sections.slice(offset, offset + path.length);
      offset += path.length;
      return branch;
    })
    .filter((branch) => branch.length);
}

/** Descending flood merges locate key saddles and distinguish prominence from absolute height. */
export function summitHierarchy(mesh: PhysicalMesh, cells: number[], height: ArrayLike<number>) {
  const active = new Set<number>(),
    parent = new Map<number, number>(),
    peak = new Map<number, number>(),
    result: { cell: number; prominence: number; parent: number; saddle: number }[] = [];
  const root = (i: number): number => {
    let next = i;
    while (parent.get(next) !== next) next = parent.get(next)!;
    while (i !== next) {
      const old = parent.get(i)!;
      parent.set(i, next);
      i = old;
    }
    return next;
  };
  const ordered = [...cells].sort((a, b) => height[b] - height[a] || a - b);
  for (const i of ordered) {
    active.add(i);
    parent.set(i, i);
    peak.set(i, i);
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const j = mesh.neighbors[i * mesh.stride + edge];
      if (!active.has(j)) continue;
      const a = root(i),
        b = root(j);
      if (a === b) continue;
      const pa = peak.get(a)!,
        pb = peak.get(b)!,
        high = higherPeak(height, pa, pb),
        low = high === pa ? pb : pa;
      if (height[low] > height[i])
        result.push({ cell: low, prominence: height[low] - height[i], parent: high, saddle: i });
      parent.set(b, a);
      peak.set(a, high);
    }
  }
  if (ordered.length) {
    const highest = ordered[0],
      floor = height[ordered.at(-1)!];
    result.push({ cell: highest, prominence: height[highest] - floor, parent: -1, saddle: -1 });
  }
  return result.sort((a, b) => b.prominence - a.prominence || height[b.cell] - height[a.cell]);
}
function higherPeak(height: ArrayLike<number>, a: number, b: number) {
  return height[a] > height[b] || (height[a] === height[b] && a < b) ? a : b;
}
