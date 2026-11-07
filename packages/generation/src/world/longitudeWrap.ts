import type { PhysicalField } from "./field";
import type { Band } from "@atlas/domain";
import type { PhysicalProfile } from "./profile";
import { nearestTriangle } from "./mesh";
import { physicalDistance } from "./physicalMetric";

/**
 * The world's west and east edges when the map spans a wrapping world's full
 * width; null otherwise. A region of a wrapping world keeps open edges and
 * takes its inflow from its own boundary.
 */
export function wrappedEdges(map: PhysicalField, p: PhysicalProfile): [number, number] | null {
  if (!p.WrapLongitude || !p.WorldExtentX) return null;
  const [west, east] = p.WorldExtentX,
    tolerance = (east - west) * 0.01;
  let low = Infinity,
    high = -Infinity;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.membership(i) !== 1) continue;
    const x = map.mesh.x(i) + map.mesh.origin[0];
    low = Math.min(low, x);
    high = Math.max(high, x);
  }
  return low <= west + tolerance && high >= east - tolerance ? [west, east] : null;
}
/**
 * Compatibility for climate links on an open numerical mesh. Periodic world
 * meshes already join terrain, plates and rivers through their own adjacency.
 * A climate link into an exterior halo is redirected to the opposite longitude.
 */
export function wrapLinks(
  map: PhysicalField,
  p: PhysicalProfile,
  links: Band,
  admissible: (j: number) => boolean = () => true
) {
  const edges = wrappedEdges(map, p);
  if (!edges) return false;
  const mesh = map.mesh;
  for (let i = 0; i < mesh.count; i++) {
    const link = links.get(i);
    if (link < 0 || !inside(edges, mesh.x(i) + mesh.origin[0])) continue;
    const k = across(map, edges, link);
    if (k >= 0 && k !== i && admissible(k)) links.set(i, k);
  }
  return true;
}
/**
 * Distance along a transport link. A link across the wrapped seam spans the
 * short way round, not the width of the map.
 */
export function linkDistance(map: PhysicalField, p: PhysicalProfile) {
  const mesh = map.mesh,
    edges = wrappedEdges(map, p);
  if (!edges) return (i: number, j: number) => physicalDistance(mesh, i, j);
  const width = edges[1] - edges[0];
  return (i: number, j: number) => {
    let dx = mesh.x(j) - mesh.x(i);
    if (Math.abs(dx) > width / 2) dx -= Math.sign(dx) * width;
    return Math.hypot(dx, mesh.y(j) - mesh.y(i));
  };
}
const inside = ([west, east]: [number, number], x: number) => x >= west && x <= east;
/** The cell standing in for `j` on the opposite edge, or `j` itself when it lies inside. */
function across(map: PhysicalField, edges: [number, number], j: number) {
  const mesh = map.mesh,
    [west, east] = edges,
    x = mesh.x(j) + mesh.origin[0];
  if (inside(edges, x)) return j;
  const wrapped = x < west ? x + (east - west) : x - (east - west);
  return nearestTriangle(mesh, wrapped - mesh.origin[0], mesh.y(j));
}
