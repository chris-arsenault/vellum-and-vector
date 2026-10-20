import type { PhysicalMesh } from "./mesh";

/** Regional principal axis with area-weighted sections, independent of cell count. */
export function regionAxis(mesh: PhysicalMesh, cells: number[], sectionLength: number) {
  const area = cells.reduce((sum, i) => sum + mesh.areas[i], 0),
    cx = cells.reduce((sum, i) => sum + mesh.x[i] * mesh.areas[i], 0) / area,
    cy = cells.reduce((sum, i) => sum + mesh.y[i] * mesh.areas[i], 0) / area;
  let xx = 0,
    xy = 0,
    yy = 0;
  for (const i of cells) {
    const x = mesh.x[i] - cx,
      y = mesh.y[i] - cy;
    xx += x * x * mesh.areas[i];
    xy += x * y * mesh.areas[i];
    yy += y * y * mesh.areas[i];
  }
  const angle = Math.atan2(2 * xy, xx - yy) / 2,
    dx = Math.cos(angle),
    dy = Math.sin(angle),
    along = (i: number) => (mesh.x[i] - cx) * dx + (mesh.y[i] - cy) * dy,
    first = cells.reduce((minimum, i) => Math.min(minimum, along(i)), Infinity),
    bins = new Map<number, number[]>();
  for (const i of cells) {
    const bin = Math.floor((along(i) - first) / sectionLength),
      members = bins.get(bin) ?? [];
    members.push(i);
    bins.set(bin, members);
  }
  return [...bins]
    .sort(([a], [b]) => a - b)
    .map(([, members]) => {
      const size = members.reduce((sum, i) => sum + mesh.areas[i], 0),
        x = members.reduce((sum, i) => sum + mesh.x[i] * mesh.areas[i], 0) / size,
        y = members.reduce((sum, i) => sum + mesh.y[i] * mesh.areas[i], 0) / size,
        width = Math.max(
          sectionLength * 0.4,
          ...members.map((i) => Math.abs((mesh.x[i] - x) * -dy + (mesh.y[i] - y) * dx))
        );
      return {
        cells: members,
        point: [x + mesh.origin[0], y + mesh.origin[1]] as [number, number],
        width,
      };
    });
}

export function sectionQuantile(cells: number[], values: ArrayLike<number>, quantile: number) {
  const ordered = cells.map((i) => values[i]).sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * quantile))];
}
