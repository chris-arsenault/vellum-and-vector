import { fieldPosition, type AtlasFeature } from "@atlas/domain";
import { CellList } from "@atlas/domain";
import type { RegionalState } from "./state";

/** A captured river: its identity and the regional cells its course crosses. */
export interface CapturedCourse {
  feature: AtlasFeature;
  cells: Int32Array;
  discharge: number;
  order: number;
}

/**
 * The captured rivers crossing this frame. Their courses are evidence of where the water
 * runs, not frozen geometry: terrain develops their valleys and the developed stem that
 * follows a course takes its identity.
 */
export function capturedCourses(state: RegionalState): CapturedCourse[] {
  const g = state.surface,
    courses: CapturedCourse[] = [],
    reader = state.sourceFeatures;
  if (!reader) return courses;
  for (const f of reader.values({ areaId: state.input.areaId })) {
    if (f.kind !== "river" || state.removedProducts?.has(f.id)) continue;
    const lines =
      f.geometry.type === "LineString"
        ? [f.geometry.coordinates]
        : f.geometry.type === "MultiLineString"
          ? f.geometry.coordinates
          : [];
    const cells = new CellList(),
      seen = new Set<number>();
    for (const line of lines)
      for (let k = 1; k < line.length; k++) {
        const a = chartCell(state, line[k - 1]),
          b = chartCell(state, line[k]);
        for (const cell of segmentCells(g.width, g.height, a, b))
          if (cell >= 0 && !seen.has(cell)) {
            seen.add(cell);
            cells.push(cell);
          }
      }
    if (!cells.length) continue;
    courses.push({
      feature: f,
      cells: cells.finish(),
      discharge: Number(f.attributes.discharge ?? 0),
      order: Number(f.attributes.order ?? 1),
    });
  }
  return courses;
}

/** Fractional grid coordinates of a canonical position in this map's chart, or outside. */
function chartCell(state: RegionalState, [x, y]: number[]): [number, number] {
  const g = state.surface,
    p = fieldPosition(g, { x, y, z: 0 });
  return [
    ((p.x - g.bounds[0]) / (g.bounds[2] - g.bounds[0])) * (g.width - 1),
    ((p.y - g.bounds[1]) / (g.bounds[3] - g.bounds[1])) * (g.height - 1),
  ];
}

/** Cells along a segment in fractional grid coordinates, stepping half a cell at a time. */
function* segmentCells(
  width: number,
  height: number,
  [ax, ay]: [number, number],
  [bx, by]: [number, number]
) {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps,
      x = Math.round(ax + (bx - ax) * t),
      y = Math.round(ay + (by - ay) * t);
    yield x < 0 || y < 0 || x >= width || y >= height ? -1 : y * width + x;
  }
}

/** Course membership per cell: the index of the course crossing it, or -1. */
export function courseIndex(state: RegionalState, courses: CapturedCourse[]) {
  const owner = new Int32Array(state.surface.active.length).fill(-1);
  courses.forEach((course, index) => {
    for (const cell of course.cells) if (owner[cell] < 0) owner[cell] = index;
  });
  return owner;
}
