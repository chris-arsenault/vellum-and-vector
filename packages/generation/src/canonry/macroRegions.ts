import type { PhysicalMesh } from "./mesh";
import { PriorityQueue } from "./priorityQueue";

export function macroComponents(mesh: PhysicalMesh, includes: (i: number) => boolean) {
  const seen = new Uint8Array(mesh.count),
    result: number[][] = [];
  for (let start = 0; start < mesh.count; start++) {
    if (seen[start] || !includes(start)) continue;
    const members = [start];
    seen[start] = 1;
    for (let head = 0; head < members.length; head++) {
      const i = members[head];
      for (let edge = 0; edge < mesh.degree[i]; edge++) {
        const j = mesh.neighbors[i * mesh.stride + edge];
        if (j < 0 || seen[j] || !includes(j)) continue;
        seen[j] = 1;
        members.push(j);
      }
    }
    result.push(members);
  }
  return result;
}

export function macroDistances(
  mesh: PhysicalMesh,
  seeds: (i: number) => boolean,
  admits: (i: number) => boolean,
  reach: number,
  resistance: (i: number, j: number) => number = () => 1
) {
  const distance = new Float64Array(mesh.count).fill(Infinity),
    source = new Int32Array(mesh.count).fill(-1),
    queue = new PriorityQueue<{ i: number; distance: number }>(
      (a, b) => a.distance - b.distance || a.i - b.i
    );
  for (let i = 0; i < mesh.count; i++)
    if (seeds(i)) {
      distance[i] = 0;
      source[i] = i;
      queue.push({ i, distance: 0 });
    }
  while (queue.count) {
    const current = queue.pop(),
      i = current.i;
    if (distance[i] !== current.distance) continue;
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const at = i * mesh.stride + edge,
        j = mesh.neighbors[at],
        next = current.distance + mesh.edgeLength[at] * resistance(i, j);
      if (j < 0 || !admits(j) || next > reach || next >= distance[j]) continue;
      distance[j] = next;
      source[j] = source[i];
      queue.push({ i: j, distance: next });
    }
  }
  return { distance, source };
}

/** Regularize supported bodies in metres, allowing joins and contraction. */
export function reconstructRegion(
  mesh: PhysicalMesh,
  mask: Uint8Array,
  admits: (i: number) => boolean,
  radius: number,
  passage: (i: number) => boolean = () => true
) {
  const outward = macroDistances(mesh, (i) => Boolean(mask[i]), admits, radius),
    dilated = Uint8Array.from(mask, (value, i) =>
      Number(Boolean(value) || outward.distance[i] <= radius)
    );
  const inward = macroDistances(
      mesh,
      (i) => !dilated[i] || Boolean(mesh.boundary[i]),
      () => true,
      radius
    ),
    result = Uint8Array.from(mask, (value, i) =>
      Number(admits(i) && (Boolean(value) || (dilated[i] && inward.distance[i] >= radius)))
    );
  removeDebris(mesh, result, radius);
  regularizeBoundary(mesh, mask, result, admits, radius);
  preserveConnections(mesh, mask, result, radius, passage);
  return { mask: result, source: outward.source };
}
function removeDebris(mesh: PhysicalMesh, mask: Uint8Array, radius: number) {
  for (const cells of macroComponents(mesh, (i) => Boolean(mask[i]))) {
    const area = cells.reduce((sum, i) => sum + mesh.areas[i], 0);
    if (area < Math.PI * (radius * 0.18) ** 2) for (const i of cells) mask[i] = 0;
  }
}
function regularizeBoundary(
  mesh: PhysicalMesh,
  evidence: Uint8Array,
  mask: Uint8Array,
  admits: (i: number) => boolean,
  radius: number
) {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < mesh.count; i++) {
      if (!admits(i)) continue;
      const next = boundaryChoice(mesh, evidence, mask, radius, i);
      if (next !== mask[i]) {
        mask[i] = next;
        changed = true;
      }
    }
  }
}
function boundaryChoice(
  mesh: PhysicalMesh,
  evidence: Uint8Array,
  mask: Uint8Array,
  radius: number,
  i: number
) {
  let zero = evidence[i] ? mesh.areas[i] : 0,
    one = evidence[i] ? 0 : mesh.areas[i];
  for (let edge = 0; edge < mesh.degree[i]; edge++) {
    const at = i * mesh.stride + edge,
      j = mesh.neighbors[at];
    if (j < 0) continue;
    const cost = radius * mesh.faceLength[at] * 0.2;
    if (mask[j]) zero += cost;
    else one += cost;
  }
  return one < zero ? 1 : one > zero ? 0 : mask[i];
}
function preserveConnections(
  mesh: PhysicalMesh,
  original: Uint8Array,
  result: Uint8Array,
  radius: number,
  passage: (i: number) => boolean
) {
  const { parent, reached } = exteriorParents(mesh, original, passage),
    clearance = macroDistances(
      mesh,
      (i) => Boolean(original[i]),
      () => true,
      radius * 0.35
    ),
    cores = macroComponents(
      mesh,
      (i) => !original[i] && passage(i) && clearance.distance[i] >= radius * 0.35
    ).filter(
      (cells) => cells.reduce((sum, i) => sum + mesh.areas[i], 0) >= Math.PI * (radius * 0.3) ** 2
    ),
    seeds = new Set(cores.flat()),
    openings = macroDistances(
      mesh,
      (i) => seeds.has(i),
      (i) => !original[i] && passage(i),
      radius * 0.35
    );
  for (let i = 0; i < mesh.count; i++) if (openings.distance[i] <= radius * 0.35) result[i] = 0;
  for (const core of cores) {
    let i = core.find((i) => Boolean(reached[i])) ?? -1;
    while (i >= 0) {
      result[i] = 0;
      i = parent[i];
    }
  }
}
function exteriorParents(
  mesh: PhysicalMesh,
  original: Uint8Array,
  passage: (i: number) => boolean
) {
  const parent = new Int32Array(mesh.count).fill(-1),
    reached = new Uint8Array(mesh.count),
    queue = Array.from(mesh.boundary.keys()).filter((i) => !original[i] && mesh.boundary[i] && passage(i));
  queue.forEach((i) => reached[i] = 1);
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const j = mesh.neighbors[i * mesh.stride + edge];
      if (j < 0 || original[j] || reached[j] || !passage(j)) continue;
      reached[j] = 1;
      parent[j] = i;
      queue.push(j);
    }
  }
  return { parent, reached };
}
