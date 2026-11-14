import type { PhysicalField } from "../world/field";
import { units } from "../world/math";
import { groundOf } from "./ground";
import { yieldingPlane, seamContinuity, detachmentSpread } from "./groundQueries";

const faultPlane = yieldingPlane(undefined, "detachment");
function facetPlanes(map: PhysicalField, cell: number) {
  const ground = groundOf(map);
  return (["land", "cut"] as const).flatMap((facet) => {
    const share = ground.share(cell, facet);
    return share > 0
      ? [
          {
            share,
            surface: ground.surface(cell, facet),
            plane: ground.fold(cell, faultPlane, facet),
          },
        ]
      : [];
  });
}
/** Retained interval overlap, adjusted for present bedding dip, supplies lateral continuity. */
export function inheritedDetachment(map: PhysicalField, i: number) {
  const source = facetPlanes(map, i).filter(({ plane }) => plane.overburden > 0);
  if (!source.length) return 0;
  const connected = new Float64Array(source.length);
  let faces = 0;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j < 0) continue;
    const face = map.mesh.faceLength(i, edge),
      distance = map.mesh.edgeLength(i, edge),
      dx = units(map.mesh.edgeX(i, edge) * distance),
      dy = units(map.mesh.edgeY(i, edge) * distance),
      neighbors = facetPlanes(map, j);
    source.forEach((a, index) => {
      for (const b of neighbors)
        connected[index] +=
          face * b.share * seamContinuity(a.plane, b.plane, b.surface - a.surface, dx, dy);
    });
    faces += face;
  }
  return source.reduce(
    (sum, part, index) =>
      sum + part.share * detachmentSpread(part.plane, faces > 0 ? connected[index] / faces : 0),
    0
  );
}
