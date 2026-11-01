import { CellList, type AtlasFeature } from "@atlas/domain";
import type { Geometry } from "geojson";
import { cellAt, isContent, regionalSpan } from "./lattice";
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

/** The captured course a developed river stands for: its geometry, size and source identity. */
export interface CarriedCourse {
  sourceId: string;
  geometry: Geometry;
  discharge: number;
  order: number;
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
  const rivers = [...reader.values({ areaId: state.regional.input.areaId })]
      .filter((f) => f.kind === "river")
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    carriedSources = new Set(
      rivers.map((f) => carriedCourse(f)?.sourceId).filter((id): id is string => !!id)
    ),
    // A developed river that took a captured course's identity carries that course with it
    // (see `carryIdentities`), so the evidence survives the product's regeneration and the
    // source line, where it is still present, is not read twice.
    superseded = (f: AtlasFeature) =>
      Boolean(state.regional.removedProducts?.has(f.id)) || carriedSources.has(f.id),
    // Every river of the stem that took the identity carries the same course; it is one
    // course, read once (otherwise each carrier would claim another reach every run).
    read = new Set<string>();
  for (const f of rivers) {
    const carried = carriedCourse(f);
    if (!carried && superseded(f)) continue;
    if (carried && read.has(carried.sourceId)) continue;
    const course = courseOf(state, f, carried);
    if (!course) continue;
    courses.push(course);
    if (carried) read.add(carried.sourceId);
  }
  return courses;
}

export const carriedCourse = (f: AtlasFeature) =>
  f.attributes.capturedCourse as CarriedCourse | undefined;

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

export function courseLines(geometry: Geometry): number[][][] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

/** The distinct content cells a set of lines crosses, in order along the lines. */
export function courseCells(state: RegionalState, lines: number[][][]) {
  const mesh = state.physical.map.mesh,
    step = regionalSpan(state) / 2,
    cells = new CellList(),
    seen = new Uint8Array(mesh.count);
  for (const line of lines)
    for (let k = 1; k < line.length; k++) {
      const [ax, ay] = line[k - 1],
        [bx, by] = line[k],
        steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps,
          cell = cellAt(mesh, ax + (bx - ax) * t, ay + (by - ay) * t);
        if (cell < 0 || seen[cell] || !isContent(mesh, cell)) continue;
        seen[cell] = 1;
        cells.push(cell);
      }
    }
  return cells.finish();
}

/** Course membership per cell: the index of the course crossing it, or -1. */
export function courseIndex(state: RegionalState, courses: CapturedCourse[]) {
  const owner = new Int32Array(state.physical.map.mesh.count).fill(-1);
  courses.forEach((course, index) => {
    for (const cell of course.cells) if (owner[cell] < 0) owner[cell] = index;
  });
  return owner;
}
