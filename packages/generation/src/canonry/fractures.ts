import { meshDeltaX } from "./mesh";
// FractureNetworkLayer.cs, Canonry 0f62584c; world-space steering replaces lattice directions.
import type { PhysicalField } from "./field";
import { areaBudget, mediumArea } from "./worldScale";
import type { PhysicalContext } from "./context";
import { hashSigned, hashUnit } from "./noise";
import { round, truncate } from "./math";
import { nearestTriangle } from "./mesh";
import { worldCandidates } from "./worldSources";

type Coordinate = [number, number];
const cellAt = (map: PhysicalField, [x, y]: Coordinate) => nearestTriangle(map.mesh, x, y);
function separatedRoot(
  candidates: Coordinate[],
  roots: Coordinate[],
  branch: number,
  minimum: number
) {
  const skip = branch % Math.max(1, truncate(candidates.length / 8));
  return (
    candidates
      .slice(skip)
      .find(([x, y]) => roots.every(([a, b]) => Math.hypot(x - a, y - b) >= minimum)) ??
    candidates[branch % candidates.length]
  );
}
function directedStep(
  map: PhysicalField,
  seed: number,
  point: Coordinate,
  angle: number,
  branch: number,
  step: number,
  distance: number
) {
  let best: { point: Coordinate; angle: number } | undefined,
    score = -Infinity;
  // Angles are relative to the evolving heading, never the global mesh axes.
  for (const turn of [-0.65, -0.325, 0, 0.325, 0.65]) {
    const direction = angle + turn;
    const next: Coordinate = [
      point[0] + Math.cos(direction) * distance,
      point[1] + Math.sin(direction) * distance,
    ];
    const j = cellAt(map, next);
    if (j < 0) continue;
    const novelty = map.FractureConductance[j] < 560 ? 0.22 : -0.08;
    const value =
      Math.cos(turn) +
      novelty +
      (map.TectonicStrain[j] / 1000) * 0.12 +
      hashSigned(
        seed ^ 0x6c53,
        branch + Math.floor(step / 10_000),
        Math.floor(next[0] / 10_000) ^ Math.floor(next[1] / 10_000)
      ) *
        0.12;
    if (value > score) {
      score = value;
      best = { point: next, angle: direction };
    }
  }
  return best;
}
export function widenFracture(
  map: PhysicalField,
  point: Coordinate,
  width: number,
  strength: number
) {
  const source = cellAt(map, point);
  if (source < 0) return;
  const queue = [source],
    visited = new Set(queue);
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const distance = Math.hypot(
      meshDeltaX(map.mesh, map.mesh.x[i] - point[0]),
      map.mesh.y[i] - point[1]
    );
    const support = width / 2 + Math.hypot(map.mesh.cellWidth[i], map.mesh.cellHeight[i]) / 2;
    if (distance > support && i !== source) continue;
    map.FractureConductance[i] = Math.max(
      map.FractureConductance[i],
      i === source ? strength : round(560 * Math.max(0, 1 - distance / support))
    );
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      if (j < 0 || visited.has(j)) continue;
      visited.add(j);
      queue.push(j);
    }
  }
}
function growBranch(
  map: PhysicalField,
  c: PhysicalContext,
  root: Coordinate,
  branch: number,
  nodes: Coordinate[]
) {
  let point = root,
    angle = hashUnit(c.Seed ^ 0x3da7, branch, 0) * Math.PI * 2;
  const length =
    c.Profile.FractureMinimumLength +
    (c.Profile.FractureMaximumLength - c.Profile.FractureMinimumLength) *
      hashUnit(c.Seed ^ 0x4f39, branch, 1);
  const fault = {
    id: `fault:${c.Seed}:${branch}`,
    coordinates: [] as Coordinate[],
    width: c.Profile.FractureWidth,
  };
  map.faults.push(fault);
  const increment = Math.min(fault.width / 2, length / 32);
  for (let step = 0; step < length; step += increment) {
    const strength = 760 + truncate(hashUnit(c.Seed, branch, Math.floor(step / 10_000)) * 240);
    nodes.push(point);
    fault.coordinates.push(point);
    widenFracture(map, point, fault.width, strength);
    const next = directedStep(
      map,
      c.Seed,
      point,
      angle,
      branch,
      step,
      Math.min(increment, length - step)
    );
    if (!next) break;
    point = next.point;
    angle = next.angle + hashSigned(c.Seed ^ 0x5ac1, branch, Math.floor(step / 10_000)) * 0.22;
  }
  fault.coordinates.push(point);
}
function candidateScore(map: PhysicalField, i: number) {
  return map.TectonicStrain[i] * 0.48 + map.Uplift[i] * 310 + map.RidgeInfluence[i] * 120;
}
/**
 * Initial maps start from the conductance floor; each later epoch, older
 * fractures and cooled volcanic conduits heal toward it before new ones open.
 */
function prepareFractures(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile,
    keep = c.IsEvolutionEpoch ? p.FractureRetentionPerEpoch / 1000 : 1;
  for (let i = 0; i < map.mesh.count; i++)
    map.FractureConductance[i] = Math.max(
      p.FractureConductanceFloor,
      round(
        p.FractureConductanceFloor +
          (map.FractureConductance[i] - p.FractureConductanceFloor) * keep
      )
    );
}
export function fractureNetwork(map: PhysicalField, c: PhysicalContext) {
  prepareFractures(map, c);
  const count =
    c.TectonicStrength === 0
      ? 0
      : areaBudget((c.Profile.FractureBranchCount * c.TectonicStrength) / 1000, mediumArea(map));
  if (count === 0) return;
  const candidates = worldCandidates(map.mesh, c.Seed, Math.max(1024, count * 256))
    .map((source) => ({
      ...source,
      score:
        candidateScore(map, nearestTriangle(map.mesh, source.x, source.y)) + source.priority * 90,
    }))
    .sort((a, b) => b.score - a.score)
    .map((source): Coordinate => [source.x, source.y]);
  const nodes: Coordinate[] = [],
    roots: Coordinate[] = [];
  for (let branch = 0; branch < count; branch++) {
    const root =
      branch > 0 && branch % 3 === 0 && nodes.length > 0
        ? nodes[truncate(hashUnit(c.Seed ^ 0x29f1, branch, 0) * nodes.length) % nodes.length]
        : separatedRoot(candidates, roots, branch, c.Profile.FractureMinimumSpacing);
    roots.push(root);
    growBranch(map, c, root, branch, nodes);
  }
}

/** Plan against the current terrain; refining support must not choose a different network. */
export function plannedFractures(map: PhysicalField, c: PhysicalContext) {
  const scratch: PhysicalField = {
    ...map,
    FractureConductance: map.FractureConductance.slice(),
    faults: [],
  };
  fractureNetwork(scratch, c);
  return scratch.faults;
}
export function applyPlannedFractures(
  map: PhysicalField,
  c: PhysicalContext,
  faults: PhysicalField["faults"]
) {
  prepareFractures(map, c);
  faults.forEach((fault, branch) => {
    let distance = 0;
    fault.coordinates.forEach((point, index) => {
      if (index)
        distance += Math.hypot(
          point[0] - fault.coordinates[index - 1][0],
          point[1] - fault.coordinates[index - 1][1]
        );
      const strength =
        760 + truncate(hashUnit(c.Seed, branch, Math.floor(distance / 10_000)) * 240);
      widenFracture(map, point, fault.width, strength);
    });
    map.faults.push(fault);
  });
}
