import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { nativePosition } from "./atlasWorkspace";
import { nearestTriangle } from "./mesh";
import { Landform } from "./codes";
import { macroComponents } from "./macroRegions";
import { addTerrainProfile, fixedTerrain, profileElevation } from "./macroTerrain";
import { PriorityQueue } from "./priorityQueue";
import { hashUnit } from "./noise";
import { roundStructuralProfile } from "./macroCurves";

/** Lowest supported crossing between two valley approaches, with physical distance tie breaks. */
export function crossingPath(
  work: AtlasPhysicalWorkspace,
  start: number,
  end: number,
  center: number,
  radius: number,
  height = (i: number) => work.map.Elevation[i]
) {
  const map = work.map,
    mesh = map.mesh,
    costs = new Float64Array(mesh.count).fill(Infinity),
    lengths = new Float64Array(mesh.count).fill(Infinity),
    parents = new Int32Array(mesh.count).fill(-1),
    queue = new PriorityQueue<{ i: number; cost: number; length: number }>(
      (a, b) => a.cost - b.cost || a.length - b.length || a.i - b.i
    );
  costs[start] = height(start);
  lengths[start] = 0;
  queue.push({ i: start, cost: costs[start], length: 0 });
  while (queue.count) {
    const current = queue.pop(),
      i = current.i;
    if (!sameCost(current, costs[i], lengths[i])) continue;
    if (i === end) break;
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const at = i * mesh.stride + edge,
        j = mesh.neighbors[at];
      if (!crossingCandidate(work, j, center, radius)) continue;
      const cost = Math.max(current.cost, height(j)),
        length = current.length + mesh.edgeLength[at];
      if (!betterCost(cost, length, costs[j], lengths[j])) continue;
      costs[j] = cost;
      lengths[j] = length;
      parents[j] = i;
      queue.push({ i: j, cost, length });
    }
  }
  if (!Number.isFinite(costs[end])) return [];
  const path = [end];
  while (path.at(-1) !== start) path.push(parents[path.at(-1)!]);
  return path.reverse();
}
function sameCost(current: { cost: number; length: number }, cost: number, length: number) {
  return current.cost === cost && current.length === length;
}
function betterCost(cost: number, length: number, previousCost: number, previousLength: number) {
  return (
    Number.isFinite(cost) &&
    (cost < previousCost || (cost === previousCost && length < previousLength))
  );
}
function crossingCandidate(
  work: AtlasPhysicalWorkspace,
  i: number,
  center: number,
  radius: number
) {
  const map = work.map,
    mesh = map.mesh;
  return (
    i >= 0 &&
    !map.WaterKindCodes[i] &&
    !fixedTerrain(work, i) &&
    Math.hypot(mesh.x[i] - mesh.x[center], mesh.y[i] - mesh.y[center]) <= radius
  );
}

export function composePass(
  work: AtlasPhysicalWorkspace,
  center: number,
  start: number,
  end: number
) {
  const map = work.map,
    mesh = map.mesh,
    radius = work.profile.RidgeWidth * 1.5,
    dx = mesh.x[start] - mesh.x[center],
    dy = mesh.y[start] - mesh.y[center],
    lengthToStart = Math.hypot(dx, dy),
    side = (i: number) =>
      ((mesh.x[i] - mesh.x[center]) * dx + (mesh.y[i] - mesh.y[center]) * dy) / lengthToStart,
    first = crossingPath(work, start, center, center, radius, (i) =>
      side(i) >= -mesh.spacing * 0.2 ? map.Elevation[i] : Infinity
    ),
    last = crossingPath(work, center, end, center, radius, (i) =>
      side(i) <= mesh.spacing * 0.2 ? map.Elevation[i] : Infinity
    ),
    cells = first.length && last.length ? [...first, ...last.slice(1)] : [];
  if (cells.length < 3) return;
  const distances = [0];
  for (let n = 1; n < cells.length; n++)
    distances.push(
      distances[n - 1] +
        Math.hypot(mesh.x[cells[n]] - mesh.x[cells[n - 1]], mesh.y[cells[n]] - mesh.y[cells[n - 1]])
    );
  const length = distances.at(-1)!,
    a = profileElevation(work, map.Elevation[start]),
    b = profileElevation(work, map.Elevation[end]),
    saddle = Math.min(
      profileElevation(work, map.Elevation[center]),
      Math.max(a, b) +
        Math.max(0, profileElevation(work, map.Elevation[center]) - Math.max(a, b)) * 0.45,
      Math.max(a, b) + length * 0.012
    );
  const profile = roundStructuralProfile(
    {
      id: `pass:${Math.round(mesh.x[center])}:${Math.round(mesh.y[center])}`,
      points: cells.map((i): [number, number] => {
        const p = nativePosition(work, i);
        return [p.x, p.y];
      }),
      widths: distances.map(
        (distance) =>
          work.profile.RidgeWidth * (0.13 - 0.095 * Math.sin((Math.PI * distance) / length))
      ),
      values: {
        elevation: distances.map((distance) => {
          const t = distance / length;
          return a * (1 - t) + b * t + Math.max(0, saddle - (a + b) / 2) * Math.sin(Math.PI * t);
        }),
        landform: distances.map((distance) =>
          Math.abs(distance / length - 0.5) < 0.2 ? Landform.Pass : Landform.Valley
        ),
      },
      operation: "lower" as const,
    },
    work.profile.RidgeWidth * 0.2,
    [cells.indexOf(center)]
  );
  addTerrainProfile(work, profile);
  work.finishing!.passes.push({ id: profile.id, cells, profile });
}
function approaches(work: AtlasPhysicalWorkspace, center: number) {
  const a = approach(work, center, -1);
  if (a < 0) return null;
  const b = approach(work, center, a);
  return b < 0 ? null : [a, b];
}
function approach(work: AtlasPhysicalWorkspace, center: number, opposite: number) {
  const map = work.map,
    mesh = map.mesh,
    radius = work.profile.RidgeWidth * 0.65;
  let selected = -1,
    score = Infinity;
  for (let i = 0; i < mesh.contentCount; i++) {
    if (!crossingCandidate(work, i, center, radius)) continue;
    const distance = Math.hypot(mesh.x[i] - mesh.x[center], mesh.y[i] - mesh.y[center]);
    if (distance < radius * 0.4 || !oppositeSide(work, center, i, opposite)) continue;
    const valley =
        map.RiverOrders[i] > 0 ||
        [Landform.Valley, Landform.UValley, Landform.Gorge].includes(map.LandformCodes[i]),
      candidate = map.Elevation[i] - (valley ? 800 * 1024 : 0);
    if (candidate < score) {
      selected = i;
      score = candidate;
    }
  }
  return selected;
}
function oppositeSide(work: AtlasPhysicalWorkspace, center: number, i: number, opposite: number) {
  if (opposite < 0) return true;
  const mesh = work.map.mesh,
    dx = mesh.x[i] - mesh.x[center],
    dy = mesh.y[i] - mesh.y[center],
    ox = mesh.x[opposite] - mesh.x[center],
    oy = mesh.y[opposite] - mesh.y[center];
  return (dx * ox + dy * oy) / (Math.hypot(dx, dy) * Math.hypot(ox, oy)) <= -0.5;
}
export function composeRanges(state: GenerationState, seed: number) {
  const work = state.physical!;
  const map = work.map,
    mesh = map.mesh;
  const crests = macroComponents(
    mesh,
    (i) =>
      !map.WaterKindCodes[i] &&
      map.Elevation[i] > map.EffectiveSeaLevel + 800 * 1024 &&
      (map.RidgeInfluence[i] > 0.26 ||
        [Landform.Ridge, Landform.Peak, Landform.Pass].includes(map.LandformCodes[i]))
  );
  for (const cells of crests) {
    const hierarchy = summitHierarchy(mesh, cells, map.Elevation),
      summits = composeSummits(work, hierarchy, seed),
      member = new Set(cells),
      surrounding = macroDistances(
        mesh,
        (i) => member.has(i),
        (i) => !map.WaterKindCodes[i],
        work.profile.RidgeWidth
      ),
      supported = Array.from(mesh.x.keys()).filter(
        (i) => surrounding.distance[i] <= work.profile.RidgeWidth && !map.WaterKindCodes[i]
      ),
      includes = new Set(supported),
      footprint = membershipContour(state, supported, (i) => Number(includes.has(i)));
    const crests = connectCrests(work, summits, hierarchy, footprint);
    const passes = new Set(cells.filter((i) => map.LandformCodes[i] === Landform.Pass));
    for (const group of macroComponents(mesh, (i) => passes.has(i))) {
      const center = group.reduce((a, b) => (map.Elevation[a] < map.Elevation[b] ? a : b)),
        ends = approaches(work, center);
      if (ends) composePass(work, center, ends[0], ends[1]);
    }
    composeCrestCrossings(work, crests);
  }
}
function composeSummits(
  work: AtlasPhysicalWorkspace,
  hierarchy: ReturnType<typeof summitHierarchy>,
  seed: number
) {
  const map = work.map,
    mesh = map.mesh,
    chosen: number[] = [],
    width = work.profile.RidgeWidth * 0.55;
  for (const peak of hierarchy) {
    const i = peak.cell;
    if (
      fixedTerrain(work, i) ||
      (peak.parent >= 0 && peak.prominence < 150 * 1024) ||
      chosen.some((j) => Math.hypot(mesh.x[i] - mesh.x[j], mesh.y[i] - mesh.y[j]) < width)
    )
      continue;
    chosen.push(i);
    const p = nativePosition(work, i),
      height = profileElevation(work, map.Elevation[i]),
      emphasis = 0.06 + hashUnit(seed, Math.round(p.x / 1000), Math.round(p.y / 1000)) * 0.16;
    work.finishing!.summits.push([p.x, p.y]);
    addTerrainProfile(work, {
      id: `summit:${Math.round(p.x)}:${Math.round(p.y)}`,
      points: [[p.x, p.y]],
      widths: [width],
      operation: "raise",
      values: { elevation: [height + Math.max(0, height) * emphasis], landform: [Landform.Peak] },
    });
  }
  return chosen;
}

function connectCrests(
  work: AtlasPhysicalWorkspace,
  summits: number[],
  hierarchy: ReturnType<typeof summitHierarchy>,
  footprint: Geometry | null
) {
  const map = work.map,
    mesh = map.mesh,
    crests: number[][] = [];
  for (let n = 1; n < summits.length; n++) {
    const a = summits[n],
      distance = (i: number) => Math.hypot(mesh.x[a] - mesh.x[i], mesh.y[a] - mesh.y[i]),
      parent = hierarchy.find((p) => p.cell === a)?.parent ?? -1,
      b = summits.includes(parent) ? parent : summits[0],
      center = nearestTriangle(mesh, (mesh.x[a] + mesh.x[b]) / 2, (mesh.y[a] + mesh.y[b]) / 2),
      cells = crossingPath(
        work,
        a,
        b,
        center,
        Math.max(work.profile.RidgeWidth, distance(b) * 0.8),
        (i) => -map.Elevation[i]
      );
    if (cells.length < 2) continue;
    crests.push(cells);
    if (footprint)
      addTerrainProfile(
        work,
        roundStructuralProfile(
          {
            id: `range-flanks:${a}:${b}`,
            operation: "replace",
            points: cells.map((i) => {
              const p = nativePosition(work, i);
              return [p.x, p.y];
            }),
            widths: cells.map(() => work.profile.RidgeWidth * 0.8),
            values: { elevation: cells.map((i) => profileElevation(work, map.Elevation[i])) },
            footprint,
            strength: 0.35,
            edgeBlend: work.profile.RidgeWidth * 0.25,
          },
          work.profile.RidgeWidth * 0.35
        )
      );
    addTerrainProfile(
      work,
      roundStructuralProfile(
        {
          id: `crest:${a}:${b}`,
          operation: "raise",
          points: cells.map((i): [number, number] => {
            const p = nativePosition(work, i);
            return [p.x, p.y];
          }),
          widths: cells.map(() => work.profile.RidgeWidth * 0.24),
          values: {
            elevation: cells.map(
              (i) => profileElevation(work, map.Elevation[i]) * (map.RiverOrders[i] ? 1 : 1.04)
            ),
            landform: cells.map(() => Landform.Ridge),
          },
        },
        work.profile.RidgeWidth * 0.3
      )
    );
  }
  return crests;
}
function composeCrestCrossings(work: AtlasPhysicalWorkspace, crests: number[][]) {
  const map = work.map,
    mesh = map.mesh;
  for (const crest of crests) {
    const interior = crest.slice(1, -1);
    if (!interior.length) continue;
    const center = interior.reduce((a, b) => (map.Elevation[a] < map.Elevation[b] ? a : b)),
      p = nativePosition(work, center),
      nearby = work.finishing!.passes.some((pass) =>
        pass.profile.points.some(
          ([x, y]) => Math.hypot(x - p.x, y - p.y) < work.profile.RidgeWidth * 0.8
        )
      );
    if (nearby) continue;
    const ends = approaches(work, center);
    if (!ends || ends.some((i) => map.Elevation[i] >= map.Elevation[center] - 50 * 1024)) continue;
    if (
      Math.hypot(mesh.x[ends[0]] - mesh.x[ends[1]], mesh.y[ends[0]] - mesh.y[ends[1]]) <
      work.profile.RidgeWidth * 0.4
    )
      continue;
    composePass(work, center, ends[0], ends[1]);
  }
}
import { summitHierarchy } from "./macroSkeleton";
import { macroDistances } from "./macroRegions";
import { membershipContour } from "./geographicContours";
import type { GenerationState } from "../process";
import type { Geometry } from "geojson";
