import type { PhysicalField } from "./field";
import type { RegionMembers } from "./regionMembers";
import { meshDeltaX } from "./mesh";
import type { LandscapeEvidence } from "../worldSignificance";

export interface RegionEvidence extends LandscapeEvidence {
  span: number;
  relief: number;
}
/** Area-weighted moments include each cell's physical width, not its count. */
export function regionEvidence(
  map: PhysicalField,
  members: RegionMembers,
  strength: (i: number) => number = () => 1,
  same: (i: number) => boolean = () => true
): RegionEvidence {
  const mesh = map.mesh,
    origin = members[0];
  let area = 0,
    x = 0,
    y = 0,
    xx = 0,
    xy = 0,
    yy = 0;
  let totalStrength = 0,
    contrast = 0,
    margin = 0,
    low = Infinity,
    high = -Infinity;
  for (const i of members) {
    const a = mesh.contentArea(i),
      dx = meshDeltaX(mesh, mesh.x(i) - mesh.x(origin)),
      dy = mesh.y(i) - mesh.y(origin),
      value = strength(i);
    area += a;
    x += dx * a;
    y += dy * a;
    xx += (dx * dx + mesh.cellWidth(i) ** 2 / 12) * a;
    xy += dx * dy * a;
    yy += (dy * dy + mesh.cellHeight(i) ** 2 / 12) * a;
    totalStrength += value * a;
    low = Math.min(low, map.Elevation.get(i));
    high = Math.max(high, map.Elevation.get(i));
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge);
      if (j < 0 || same(j)) continue;
      const length = mesh.faceLength(i, edge);
      contrast += Math.max(0, value - strength(j)) * length;
      margin += length;
    }
  }
  const scale = Math.max(1, area),
    vx = Math.max(0, xx / scale - (x / scale) ** 2),
    vy = Math.max(0, yy / scale - (y / scale) ** 2),
    covariance = xy / scale - (x * y) / scale ** 2,
    difference = Math.hypot(vx - vy, 2 * covariance),
    span = Math.sqrt(6 * (vx + vy + difference)),
    breadth = Math.sqrt(Math.max(0, 6 * (vx + vy - difference)));
  return {
    area,
    span,
    breadth,
    coherence: Math.min(1, area / Math.max(1, span * breadth)),
    strength: totalStrength / scale,
    contrast: margin > 0 ? contrast / margin : 0,
    relief: (high - low) / 1024,
  };
}
