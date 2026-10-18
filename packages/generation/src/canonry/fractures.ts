// FractureNetworkLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { hashSigned, hashUnit } from "./noise";
import { round, truncate } from "./math";
import { BoundedCandidates } from "./priorityQueue";
import { triangleIdentity } from "./mesh";
import { triangleDistanceSquared } from "./radial";

function separatedRoot(
  map: PhysicalField,
  candidates: number[],
  selected: number[],
  branch: number
) {
  const minimum = Math.max(8, map.mesh.contentRadius / 5);
  const skip = branch % Math.max(1, truncate(candidates.length / 8));
  for (let index = skip; index < candidates.length; index++) {
    const i = candidates[index];
    if (selected.every((j) => triangleDistanceSquared(map.mesh, i, j) >= minimum * minimum))
      return i;
  }
  return candidates[branch % candidates.length];
}
function directedNeighbor(
  map: PhysicalField,
  seed: number,
  current: number,
  previous: number,
  angle: number,
  branch: number,
  step: number
) {
  let best = -1,
    bestScore = -Number.MAX_VALUE;
  for (let edge = 0; edge < 3; edge++) {
    const j = map.mesh.neighbors[current * 3 + edge];
    if (j < 0 || j === previous) continue;
    const direction = Math.atan2(
      Math.fround(map.mesh.y[j] - map.mesh.y[current]),
      Math.fround(map.mesh.x[j] - map.mesh.x[current])
    );
    const novelty = map.FractureConductance[j] < 560 ? 0.22 : -0.08;
    const bias = (map.TectonicStrain[j] / 1000) * 0.12;
    const score =
      Math.cos(direction - angle) +
      novelty +
      bias +
      hashSigned(seed ^ 0x6c53, branch + step, j) * 0.12;
    if (score > bestScore) {
      best = j;
      bestScore = score;
    }
  }
  return best;
}
function growBranch(
  map: PhysicalField,
  c: PhysicalContext,
  root: number,
  branch: number,
  nodes: number[]
) {
  let current = root,
    previous = -1;
  let angle = hashUnit(c.Seed ^ 0x3da7, branch, 0) * Math.PI * 2;
  const length = Math.max(
    18,
    round(map.mesh.contentRadius * (0.8 + hashUnit(c.Seed ^ 0x4f39, branch, 1)))
  );
  for (let step = 0; step < length; step++) {
    map.FractureConductance[current] = Math.max(
      map.FractureConductance[current],
      760 + truncate(hashUnit(c.Seed, branch, step) * 240)
    );
    nodes.push(current);
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[current * 3 + edge];
      if (j >= 0) map.FractureConductance[j] = Math.max(map.FractureConductance[j], 260);
    }
    const next = directedNeighbor(map, c.Seed, current, previous, angle, branch, step);
    if (next < 0) break;
    angle =
      Math.atan2(
        Math.fround(map.mesh.y[next] - map.mesh.y[current]),
        Math.fround(map.mesh.x[next] - map.mesh.x[current])
      ) +
      hashSigned(c.Seed ^ 0x5ac1, branch, step) * 0.22;
    previous = current;
    current = next;
  }
}
function candidateScore(map: PhysicalField, c: PhysicalContext, i: number) {
  const f = Math.fround;
  return f(
    f(
      f(f(map.TectonicStrain[i] * f(0.48)) + f(map.Uplift[i] * 310)) +
        f(map.RidgeInfluence[i] * 120)
    ) + f(hashUnit(c.Seed, triangleIdentity(map.mesh, i), 0) * 90)
  );
}
export function fractureNetwork(map: PhysicalField, c: PhysicalContext) {
  if (!c.IsEvolutionEpoch)
    for (let i = 0; i < map.mesh.count; i++)
      map.FractureConductance[i] = Math.max(
        map.FractureConductance[i],
        c.Profile.FractureConductanceFloor
      );
  const count =
    c.TectonicStrength === 0
      ? 0
      : Math.max(1, truncate((c.Profile.FractureBranchCount * c.TectonicStrength) / 1000));
  if (count === 0) return;
  const selection = new BoundedCandidates(Math.max(1024, count * 256));
  for (let i = 0; i < map.mesh.contentCount; i++) selection.consider(i, candidateScore(map, c, i));
  const candidates = selection.bestIndexes(),
    nodes: number[] = [],
    roots: number[] = [];
  for (let branch = 0; branch < count; branch++) {
    const root =
      branch > 0 && branch % 3 === 0 && nodes.length > 0
        ? nodes[truncate(hashUnit(c.Seed ^ 0x29f1, branch, 0) * nodes.length) % nodes.length]
        : separatedRoot(map, candidates, roots, branch);
    roots.push(root);
    growBranch(map, c, root, branch, nodes);
  }
}
