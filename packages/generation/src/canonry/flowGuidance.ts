// ConditionedFlowResolver.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import { isOpenOutlet } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp, round, toUnits } from "./math";
import { hashUnit } from "./noise";
import { contributingArea } from "./flowGraph";
import { physicalDistance, physicalGradients } from "./physicalMetric";

const epsilon = 0.0000001;
function normalize(x: number, y: number): [number, number] {
  const length = Math.max(0.000001, Math.sqrt(x * x + y * y));
  return [x / length, y / length];
}
function desiredDirection(map: PhysicalField, source: number, target: number): [number, number] {
  return normalize(
    Math.fround(map.mesh.x[target] - map.mesh.x[source]),
    Math.fround(map.mesh.y[target] - map.mesh.y[source])
  );
}
function coordinateTie(map: PhysicalField, source: number, target: number, seed: number): number {
  return hashUnit(
    seed ^ round(map.mesh.x[source] * 4096),
    round(map.mesh.y[source] * 4096) ^ round(map.mesh.x[target] * 4096),
    round(map.mesh.y[target] * 4096)
  );
}
export function legalAdjacentTarget(map: PhysicalField, source: number, target: number): boolean {
  return (
    map.WaterKindCodes[target] === 1 ||
    map.DrainageElevations[target] < map.DrainageElevations[source] ||
    (map.DrainageElevations[target] === map.DrainageElevations[source] &&
      map.DrainageRanks[target] < map.DrainageRanks[source])
  );
}
function candidateScore(
  map: PhysicalField,
  p: PhysicalProfile,
  source: number,
  target: number,
  alignment: number
): number {
  const inherited = clamp(
    toUnits(map.CumulativeFluvialErosion[target] + map.CumulativeGlacialErosion[target]),
    0,
    100
  );
  if (map.WaterKindCodes[target] === 1) return 10000 + alignment;
  const length = Math.hypot(
    map.mesh.x[source] - map.mesh.x[target],
    map.mesh.y[source] - map.mesh.y[target]
  );
  const drop = (map.DrainageElevations[source] - map.DrainageElevations[target]) / (1024 * length);
  if (drop <= 0) {
    const progress = clamp(map.DrainageRanks[source] - map.DrainageRanks[target], 0, 20);
    return (
      (alignment * p.DrainageOutletAlignmentWeight) / 10 +
      progress * 0.15 +
      (inherited * p.DrainageInheritedValleyWeight) / 1000
    );
  }
  const floorDrop = clamp(
    (map.Elevation[source] - map.Elevation[target]) / (1024 * length),
    -0.005,
    0.02
  );
  return (
    (floorDrop * p.DrainageFloorGradientWeight) / 0.1 +
    (Math.min(0.02, drop) * p.DrainageConditionedGradientWeight) / 0.1 +
    (alignment * p.DrainageOutletAlignmentWeight) / 20 +
    (inherited * p.DrainageInheritedValleyWeight) / 1000
  );
}
function descentDirection(
  map: PhysicalField,
  p: PhysicalProfile,
  source: number,
  gradient: ReturnType<typeof physicalGradients>
): [number, number] {
  const parent = map.DrainageParents[source];
  // A flat has no height gradient. Its flood parent carries the least-cost
  // corridor; looking far along that winding path replaces it with a shortcut.
  if (
    parent >= 0 &&
    map.DrainageElevations[parent] === map.DrainageElevations[source] &&
    gradient.x[source] === 0 &&
    gradient.y[source] === 0
  )
    return desiredDirection(map, source, parent);
  let x = 0,
    y = 0,
    current = source;
  for (let distance = 0; distance < p.DrainageGuidanceLookaheadDistance;)
  // Advance by the actual parent segment, including coarse/fine crossings.
  {
    const parent = map.DrainageParents[current];
    if (parent < 0) break;
    const segment = Math.min(
      physicalDistance(map.mesh, current, parent),
      p.DrainageGuidanceLookaheadDistance - distance
    );
    x -= gradient.x[current] * segment;
    y -= gradient.y[current] * segment;
    distance += segment;
    current = parent;
  }
  return Math.abs(x) < 0.000001 && Math.abs(y) < 0.000001
    ? desiredDirection(map, source, current)
    : normalize(x, y);
}
function captureScore(area: Float64Array | null, target: number, p: PhysicalProfile): number {
  return area === null
    ? 0
    : (Math.log2(1 + area[target] / 100_000_000) * p.DrainageCaptureWeight) / 1000;
}
function selectTarget(
  map: PhysicalField,
  c: PhysicalContext,
  source: number,
  area: Float64Array | null,
  gradient: ReturnType<typeof physicalGradients>
): number {
  const [dx, dy] = descentDirection(map, c.Profile, source, gradient);
  let best = -1,
    bestScore = -Number.MAX_VALUE,
    bestTie = -Number.MAX_VALUE,
    tieDecided = false;
  for (let edge = 0; edge < map.mesh.degree[source]; edge++) {
    const offset = source * map.mesh.stride + edge,
      target = map.mesh.neighbors[offset];
    if (target < 0 || !legalAdjacentTarget(map, source, target)) continue;
    const alignment = map.mesh.edgeX[offset] * dx + map.mesh.edgeY[offset] * dy;
    const score =
      candidateScore(map, c.Profile, source, target, alignment) +
      captureScore(area, target, c.Profile);
    if (score > bestScore + epsilon) {
      best = target;
      bestScore = score;
      bestTie = coordinateTie(map, source, target, c.Seed);
      tieDecided = false;
    } else if (Math.abs(score - bestScore) < epsilon) {
      tieDecided = true;
      const tie = coordinateTie(map, source, target, c.Seed);
      if (tie > bestTie) {
        best = target;
        bestTie = tie;
      }
    }
  }
  map.DrainageDecisionTotal++;
  if (tieDecided) map.DrainageTieDecisionTotal++;
  if (best < 0 && !isOpenOutlet(map, source))
    throw new Error(`Conditioned triangle ${source} has no outlet.`);
  return best;
}
export function resolveLandTargets(map: PhysicalField, c: PhysicalContext): Int32Array {
  const targets = new Int32Array(map.mesh.count).fill(-1);
  const gradient = physicalGradients(map.mesh, map.DrainageElevations);
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes[i] !== 1) targets[i] = selectTarget(map, c, i, null, gradient);
  if (c.Profile.DrainageCaptureWeight <= 0) return targets;
  const area = contributingArea(targets, map.mesh.areas);
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes[i] !== 1) targets[i] = selectTarget(map, c, i, area, gradient);
  return targets;
}
export function drainageGuidance(map: PhysicalField, c: PhysicalContext) {
  map.DrainageGuidanceTargets.set(resolveLandTargets(map, c));
}
export function selectByOutletAlignment(
  map: PhysicalField,
  candidates: number[],
  source: number,
  outlet: number,
  seed: number
): number {
  const [dx, dy] = desiredDirection(map, source, outlet);
  let best = -1,
    bestAlignment = -Number.MAX_VALUE,
    bestTie = -Number.MAX_VALUE;
  for (const candidate of candidates) {
    const [x, y] = desiredDirection(map, source, candidate),
      alignment = x * dx + y * dy;
    const tie = coordinateTie(map, source, candidate, seed);
    if (
      alignment > bestAlignment + epsilon ||
      (Math.abs(alignment - bestAlignment) < epsilon && tie > bestTie)
    ) {
      best = candidate;
      bestAlignment = alignment;
      bestTie = tie;
    }
  }
  if (best < 0) throw new Error("Flow selection requires at least one candidate.");
  return best;
}
