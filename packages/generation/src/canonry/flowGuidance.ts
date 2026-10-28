import { meshDeltaX } from "./mesh";
// ConditionedFlowResolver.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import { isOpenOutlet } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp, round, toUnits } from "./math";
import { hashUnit } from "./noise";
import { contributingArea } from "./flowGraph";
import { physicalDistance, physicalGradients } from "./physicalMetric";
import type { Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";

const epsilon = 0.0000001;
function normalize(x: number, y: number): [number, number] {
  const length = Math.max(0.000001, Math.sqrt(x * x + y * y));
  return [x / length, y / length];
}
function desiredDirection(map: PhysicalField, source: number, target: number): [number, number] {
  return normalize(
    Math.fround(meshDeltaX(map.mesh, map.mesh.x(target) - map.mesh.x(source))),
    Math.fround(map.mesh.y(target) - map.mesh.y(source))
  );
}
function coordinateTie(map: PhysicalField, source: number, target: number, seed: number): number {
  return hashUnit(
    seed ^ round(map.mesh.x(source) * 4096),
    round(map.mesh.y(source) * 4096) ^ round(map.mesh.x(target) * 4096),
    round(map.mesh.y(target) * 4096)
  );
}
export function legalAdjacentTarget(map: PhysicalField, source: number, target: number): boolean {
  const sourceElevation = map.DrainageElevations.get(source),
    targetElevation = map.DrainageElevations.get(target);
  return (
    map.WaterKindCodes.get(target) === 1 ||
    targetElevation < sourceElevation ||
    (targetElevation === sourceElevation &&
      map.DrainageRanks.get(target) < map.DrainageRanks.get(source))
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
    toUnits(map.CumulativeFluvialErosion.get(target) + map.CumulativeGlacialErosion.get(target)),
    0,
    100
  );
  if (map.WaterKindCodes.get(target) === 1) return 10000 + alignment;
  const length = Math.hypot(
    meshDeltaX(map.mesh, map.mesh.x(source) - map.mesh.x(target)),
    map.mesh.y(source) - map.mesh.y(target)
  );
  const drop =
    (map.DrainageElevations.get(source) - map.DrainageElevations.get(target)) / (1024 * length);
  if (drop <= 0) {
    const progress = clamp(map.DrainageRanks.get(source) - map.DrainageRanks.get(target), 0, 20);
    return (
      (alignment * p.DrainageOutletAlignmentWeight) / 10 +
      progress * 0.15 +
      (inherited * p.DrainageInheritedValleyWeight) / 1000
    );
  }
  const floorDrop = clamp(
    (map.Elevation.get(source) - map.Elevation.get(target)) / (1024 * length),
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
  const parent = map.DrainageParents.get(source);
  // A flat has no height gradient. Its flood parent carries the least-cost
  // corridor; looking far along that winding path replaces it with a shortcut.
  if (
    parent >= 0 &&
    map.DrainageElevations.get(parent) === map.DrainageElevations.get(source) &&
    gradient.x.get(source) === 0 &&
    gradient.y.get(source) === 0
  )
    return desiredDirection(map, source, parent);
  let x = 0,
    y = 0,
    current = source;
  for (let distance = 0; distance < p.DrainageGuidanceLookaheadDistance;)
  // Advance by the actual parent segment, including coarse/fine crossings.
  {
    const parent = map.DrainageParents.get(current);
    if (parent < 0) break;
    const segment = Math.min(
      physicalDistance(map.mesh, current, parent),
      p.DrainageGuidanceLookaheadDistance - distance
    );
    x -= gradient.x.get(current) * segment;
    y -= gradient.y.get(current) * segment;
    distance += segment;
    current = parent;
  }
  return Math.abs(x) < 0.000001 && Math.abs(y) < 0.000001
    ? desiredDirection(map, source, current)
    : normalize(x, y);
}
type Step = { target: number; x: number; y: number };
/** Downhill moves from a land cell, or null beside the sea, where existing routing decides. */
function downhillSteps(map: PhysicalField, source: number): Step[] | null {
  const steps: Step[] = [],
    elevation = map.DrainageElevations.get(source);
  for (let edge = 0; edge < map.mesh.degree(source); edge++) {
    const target = map.mesh.neighbor(source, edge);
    if (target < 0) continue;
    if (map.WaterKindCodes.get(target) === 1) return null;
    if (map.DrainageElevations.get(target) >= elevation) continue;
    steps.push({
      target,
      x: meshDeltaX(map.mesh, map.mesh.x(target) - map.mesh.x(source)),
      y: map.mesh.y(target) - map.mesh.y(source),
    });
  }
  return steps;
}
/**
 * The closest move on each side of the descent and the probability of the left one that
 * makes their expected displacement parallel to it; one side only means no choice.
 */
function bracket(moves: { x: number; y: number }[], ax: number, ay: number) {
  let left = -1,
    right = -1,
    nearest = 0;
  const cross = (m: { x: number; y: number }) => m.x * ay - m.y * ax,
    cosine = (m: { x: number; y: number }) => (m.x * ax + m.y * ay) / Math.hypot(m.x, m.y);
  moves.forEach((move, k) => {
    if (cosine(move) > cosine(moves[nearest])) nearest = k;
    if (cross(move) > 0 && (left < 0 || cosine(move) > cosine(moves[left]))) left = k;
    if (cross(move) <= 0 && (right < 0 || cosine(move) > cosine(moves[right]))) right = k;
  });
  if (left < 0 || right < 0) return { left: nearest, right: nearest, p: 1 };
  const l = cross(moves[left]),
    r = cross(moves[right]);
  return { left, right, p: -r / (l - r) };
}
function expectedStep(map: PhysicalField, cell: number, ax: number, ay: number) {
  const steps = downhillSteps(map, cell);
  if (!steps?.length) return { x: 0, y: 0 };
  const { left, right, p } = bracket(steps, ax, ay);
  return {
    x: p * steps[left].x + (1 - p) * steps[right].x,
    y: p * steps[left].y + (1 - p) * steps[right].y,
  };
}
/**
 * Three neighbours quantize flow to 120-degree sectors, so always taking the steepest one
 * draws parallel lattice lines. On sloping ground, choose between the downhill neighbours
 * either side of the true descent so that, together with each neighbour's expected next
 * step, the path follows the descent on average and gently converging flow actually meets.
 * Triangles alternate orientation, and one orientation often has a single downhill move;
 * judging two steps lets the other compensate. The draw is stable across erosion passes
 * and epochs so incision deepens the same channels.
 */
function aspectTarget(
  map: PhysicalField,
  c: PhysicalContext,
  source: number,
  gradient: ReturnType<typeof physicalGradients>
): number {
  const gx = gradient.x.get(source),
    gy = gradient.y.get(source),
    length = Math.hypot(gx, gy);
  if (length === 0) return -1;
  const ax = -gx / length,
    ay = -gy / length,
    steps = downhillSteps(map, source);
  if (!steps?.length) return -1;
  const twoSteps = steps.map((step) => {
    const next = expectedStep(map, step.target, ax, ay);
    return { x: step.x + next.x, y: step.y + next.y };
  });
  const { left, right, p } = bracket(twoSteps, ax, ay);
  const draw = hashUnit(
    c.EpochStableSeed ^ 0x2f8a,
    round(map.mesh.x(source) * 1024),
    round(map.mesh.y(source) * 1024)
  );
  return draw < p ? steps[left].target : steps[right].target;
}
function captureScore(area: Band | null, target: number, p: PhysicalProfile): number {
  return area === null
    ? 0
    : (Math.log2(1 + area.get(target) / 100_000_000) * p.DrainageCaptureWeight) / 1000;
}
/** Sloping ground follows the descent; flats, shores and enclosed cells keep scored guidance. */
function selectTarget(
  map: PhysicalField,
  c: PhysicalContext,
  source: number,
  area: Band | null,
  gradient: ReturnType<typeof physicalGradients>
): number {
  const aspect = aspectTarget(map, c, source, gradient);
  if (aspect < 0) return scoredTarget(map, c, source, area, gradient);
  map.DrainageDecisionTotal++;
  return aspect;
}
function scoredTarget(
  map: PhysicalField,
  c: PhysicalContext,
  source: number,
  area: Band | null,
  gradient: ReturnType<typeof physicalGradients>
): number {
  const [dx, dy] = descentDirection(map, c.Profile, source, gradient);
  let best = -1,
    bestScore = -Number.MAX_VALUE,
    bestTie = -Number.MAX_VALUE,
    tieDecided = false;
  for (let edge = 0; edge < map.mesh.degree(source); edge++) {
    const target = map.mesh.neighbor(source, edge);
    if (target < 0 || !legalAdjacentTarget(map, source, target)) continue;
    const alignment = map.mesh.edgeX(source, edge) * dx + map.mesh.edgeY(source, edge) * dy;
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
export function resolveLandTargets(map: PhysicalField, c: PhysicalContext): Band {
  const targets = workingArray(map, "int32", "drainage:targets").fill(-1);
  const gradient = physicalGradients(map.mesh, (i) => map.DrainageElevations.get(i), map.coverage);
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes.get(i) !== 1) targets.set(i, selectTarget(map, c, i, null, gradient));
  if (c.Profile.DrainageCaptureWeight > 0) {
    const area = contributingArea(map, targets);
    for (let i = 0; i < map.mesh.count; i++)
      if (map.WaterKindCodes.get(i) !== 1) targets.set(i, selectTarget(map, c, i, area, gradient));
    releaseWorking(map, area);
  }
  releaseWorking(map, gradient.x, gradient.y);
  return targets;
}
export function drainageGuidance(map: PhysicalField, c: PhysicalContext) {
  const targets = resolveLandTargets(map, c);
  map.DrainageGuidanceTargets.copyFrom(targets);
  releaseWorking(map, targets);
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
