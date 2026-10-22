import type { PhysicalField } from "./field";
import type { PhysicalProfile } from "./profile";
import { nearestTriangle } from "./mesh";
import { wrappedEdges } from "./longitudeWrap";

type Source = { i: number; weight: number };
type Candidate = { i: number; along: number; across: number };
/** Interpolate on an upstream segment bracketing the flow, instead of snapping its heading. */
export function directionalSources(
  map: PhysicalField,
  profile: PhysicalProfile,
  flowX: ArrayLike<number>,
  flowY: ArrayLike<number>,
  admits: (i: number) => boolean = () => true
) {
  const mesh = map.mesh,
    edges = wrappedEdges(map, profile);
  const links: Source[][] = [],
    distance = new Float64Array(mesh.count);
  const primary = new Int32Array(mesh.count).fill(-1);
  for (let i = 0; i < mesh.count; i++) {
    const candidates = sourceCandidates(map, i, flowX[i], flowY[i], edges, admits);
    const sources = bracket(candidates);
    links.push(sources);
    distance[i] = sources.reduce(
      (sum, source) =>
        sum + source.weight * candidates.find((candidate) => candidate.i === source.i)!.along,
      0
    );
    primary[i] =
      sources.reduce(
        (best, source) => (source.weight > (best?.weight ?? -1) ? source : best),
        undefined as Source | undefined
      )?.i ?? -1;
  }
  return { links, distance, primary };
}
function wrappedSource(map: PhysicalField, j: number, edges: [number, number] | null) {
  if (!edges) return j;
  const mesh = map.mesh,
    x = mesh.x[j] + mesh.origin[0],
    width = edges[1] - edges[0];
  if (x >= edges[0] && x <= edges[1]) return j;
  return nearestTriangle(mesh, mesh.x[j] + (x < edges[0] ? width : -width), mesh.y[j]);
}
function sourceCandidates(
  map: PhysicalField,
  i: number,
  flowX: number,
  flowY: number,
  edges: [number, number] | null,
  admits: (i: number) => boolean
) {
  const mesh = map.mesh,
    width = edges ? edges[1] - edges[0] : 0;
  const length = Math.hypot(flowX, flowY) || 1,
    x = -flowX / length,
    y = -flowY / length;
  const result: Candidate[] = [];
  for (const neighbor of nearby(map, i, admits)) {
    const j = wrappedSource(map, neighbor, edges);
    if (j < 0 || j === i || !admits(j)) continue;
    let dx = mesh.x[j] - mesh.x[i];
    if (width && Math.abs(dx) > width / 2) dx -= Math.sign(dx) * width;
    const dy = mesh.y[j] - mesh.y[i],
      along = dx * x + dy * y;
    if (along > mesh.spacing * 1e-6) result.push({ i: j, along, across: x * dy - y * dx });
  }
  return result;
}
function nearby(map: PhysicalField, start: number, admits: (i: number) => boolean) {
  const mesh = map.mesh,
    members = new Set<number>([start]);
  let front = [start];
  for (let ring = 0; ring < 2; ring++) {
    const next: number[] = [];
    for (const i of front)
      for (let edge = 0; edge < mesh.degree[i]; edge++) {
        const j = mesh.neighbors[i * mesh.stride + edge];
        if (j >= 0 && !members.has(j) && admits(j)) {
          members.add(j);
          next.push(j);
        }
      }
    front = next;
  }
  members.delete(start);
  return members;
}
function bracket(candidates: Candidate[]): Source[] {
  const ordered = candidates.sort(
    (a, b) => Math.abs(a.across / a.along) - Math.abs(b.across / b.along) || a.along - b.along
  );
  const a = ordered[0];
  if (!a) return [];
  if (Math.abs(a.across) < a.along * 1e-8) return [{ i: a.i, weight: 1 }];
  const b = ordered.find((candidate) => candidate.across * a.across < 0);
  if (!b) return [{ i: a.i, weight: 1 }];
  const weight = Math.abs(b.across) / (Math.abs(a.across) + Math.abs(b.across));
  return [
    { i: a.i, weight },
    { i: b.i, weight: 1 - weight },
  ];
}
