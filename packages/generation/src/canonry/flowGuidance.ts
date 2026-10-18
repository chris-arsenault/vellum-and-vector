// ConditionedFlowResolver.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import { isOpenOutlet } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp, round, toUnits } from "./math";
import { hashUnit } from "./noise";
import { contributingArea } from "./flowGraph";

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
  const drop = (map.DrainageElevations[source] - map.DrainageElevations[target]) / 1024;
  if (drop <= 0) {
    const progress = clamp(map.DrainageRanks[source] - map.DrainageRanks[target], 0, 20);
    return (
      (alignment * p.DrainageOutletAlignmentWeight) / 10 +
      progress * 0.15 +
      (inherited * p.DrainageInheritedValleyWeight) / 1000
    );
  }
  const floorDrop = clamp((map.Elevation[source] - map.Elevation[target]) / 1024, -50, 200);
  return (
    (floorDrop * p.DrainageFloorGradientWeight) / 1000 +
    (Math.min(200, drop) * p.DrainageConditionedGradientWeight) / 1000 +
    (alignment * p.DrainageOutletAlignmentWeight) / 20 +
    (inherited * p.DrainageInheritedValleyWeight) / 1000
  );
}
function descentGradient(map: PhysicalField, i: number): [number, number] {
  let x = 0,
    y = 0;
  for (let edge = 0; edge < 3; edge++) {
    const offset = i * 3 + edge,
      j = map.mesh.neighbors[offset];
    if (j < 0) continue;
    const drop = (map.DrainageElevations[i] - map.DrainageElevations[j]) / 1024;
    x += map.mesh.edgeX[offset] * drop;
    y += map.mesh.edgeY[offset] * drop;
  }
  return [x, y];
}
function descentDirection(
  map: PhysicalField,
  p: PhysicalProfile,
  source: number
): [number, number] {
  let x = 0,
    y = 0,
    current = source;
  for (let step = 0; step < p.DrainageGuidanceLookaheadSteps; step++) {
    const [gx, gy] = descentGradient(map, current);
    x += gx;
    y += gy;
    const parent = map.DrainageParents[current];
    if (parent < 0) break;
    current = parent;
  }
  return Math.abs(x) < 0.000001 && Math.abs(y) < 0.000001
    ? desiredDirection(map, source, current)
    : normalize(x, y);
}
function captureScore(area: Int32Array | null, target: number, p: PhysicalProfile): number {
  return area === null ? 0 : (Math.log2(1 + area[target]) * p.DrainageCaptureWeight) / 1000;
}
function selectTarget(
  map: PhysicalField,
  c: PhysicalContext,
  source: number,
  area: Int32Array | null
): number {
  const [dx, dy] = descentDirection(map, c.Profile, source);
  let best = -1,
    bestScore = -Number.MAX_VALUE,
    bestTie = -Number.MAX_VALUE,
    tieDecided = false;
  for (let edge = 0; edge < 3; edge++) {
    const offset = source * 3 + edge,
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
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes[i] !== 1) targets[i] = selectTarget(map, c, i, null);
  if (c.Profile.DrainageCaptureWeight <= 0) return targets;
  const area = contributingArea(targets);
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes[i] !== 1) targets[i] = selectTarget(map, c, i, area);
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
