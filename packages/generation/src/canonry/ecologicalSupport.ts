import { spatial, type LinearContourSample } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { PhysicalMesh } from "./mesh";
import { triangleFans } from "./triangleSampling";

/** Keep a closed contour support around the current decision branch's geography. */
export function ecologicalSupport(mesh: PhysicalMesh, members: number[], region: Geometry) {
  const intersects = spatial.boundsIntersectionCandidate(region),
    triangles: LinearContourSample[][] = [],
    edges = new Map<string, LinearContourSample[]>();
  const key = (p: LinearContourSample) => `${p[0]}:${p[1]}`;
  for (const triangle of triangleFans(mesh, members, () => 0)) {
    const xs = triangle.map((p) => p[0]),
      ys = triangle.map((p) => p[1]);
    if (!intersects([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)])) continue;
    triangles.push(triangle);
    triangle.forEach((a, i) => {
      const b = triangle[(i + 1) % 3],
        id = key(a) < key(b) ? `${key(a)}>${key(b)}` : `${key(b)}>${key(a)}`;
      if (edges.has(id)) edges.delete(id);
      else edges.set(id, [a, b]);
    });
  }
  return { triangles, boundary: edges.values() };
}
