import { fieldPosition, type AtlasFeature } from "@atlas/domain";
import { CellList } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { RegionalState } from "./state";

/** A captured river: its identity and the regional cells its course crosses. */
export interface CapturedCourse {
  feature: AtlasFeature;
  cells: Int32Array;
  discharge: number;
  order: number;
  /** Present when the feature is a developed river carrying a captured course. */
  carried?: CarriedCourse;
}

/**
 * The captured rivers crossing this frame. Their courses are evidence of where the water
 * runs, not frozen geometry: terrain develops their valleys and the developed stem that
 * follows a course takes its identity.
 */
export function capturedCourses(state: RegionalState): CapturedCourse[] {
  const courses: CapturedCourse[] = [],
    reader = state.sourceFeatures;
  if (!reader) return courses;
  const rivers = [...reader.values({ areaId: state.input.areaId })].filter(
      (f) => f.kind === "river"
    ),
    carriedSources = new Set(
      rivers.map((f) => carriedCourse(f)?.sourceId).filter((id): id is string => !!id)
    ),
    // A developed river that took a captured course's identity carries that course with it
    // (see `carryIdentity`), so the evidence survives the product's regeneration and the
    // source line, where it is still present, is not read twice.
    superseded = (f: AtlasFeature) =>
      Boolean(state.removedProducts?.has(f.id)) || carriedSources.has(f.id);
  for (const f of rivers) {
    const carried = carriedCourse(f);
    if (!carried && superseded(f)) continue;
    const course = courseOf(state, f, carried);
    if (course) courses.push(course);
  }
  return courses;
}

const carriedCourse = (f: AtlasFeature) => f.attributes.capturedCourse as CarriedCourse | undefined;

function courseOf(
  state: RegionalState,
  feature: AtlasFeature,
  carried: CarriedCourse | undefined
): CapturedCourse | null {
  const cells = courseCells(state, courseLines(carried?.geometry ?? feature.geometry));
  if (!cells.length) return null;
  return {
    feature,
    cells,
    discharge: Number(carried?.discharge ?? feature.attributes.discharge ?? 0),
    order: Number(carried?.order ?? feature.attributes.order ?? 1),
    carried,
  };
}

function courseLines(geometry: Geometry): number[][][] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

/** The distinct regional cells a course's lines cross, in order along the course. */
function courseCells(state: RegionalState, lines: number[][][]) {
  const g = state.surface,
    cells = new CellList(),
    seen = new Set<number>();
  for (const line of lines)
    for (let k = 1; k < line.length; k++) {
      const a = chartCell(state, line[k - 1]),
        b = chartCell(state, line[k]);
      for (const cell of segmentCells(g.width, g.height, a, b)) {
        if (cell < 0 || seen.has(cell)) continue;
        seen.add(cell);
        cells.push(cell);
      }
    }
  return cells.finish();
}

/** The captured course a developed river stands for: its geometry, size and source identity. */
export interface CarriedCourse {
  sourceId: string;
  geometry: Geometry;
  discharge: number;
  order: number;
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
