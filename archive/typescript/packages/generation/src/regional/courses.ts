import { BitSet, CellList, type AtlasFeature } from "@atlas/domain";
import type { Geometry } from "geojson";
import { reachesOf } from "../water/riverKeeping";
import type { PhysicalField } from "../world/field";
import { cellAt, isContent, regionalSpan } from "./lattice";
import type { RegionalState } from "./state";

/** A captured river: its identity and the regional cells its course crosses. */
export interface CapturedCourse {
  feature: AtlasFeature;
  cells: Int32Array;
  discharge: number;
  order: number;
  /** Identity provenance only; this does not locate the current captured course. */
  carried?: CarriedCourse;
}

/** An earlier course retained as provenance, never as the current map's spatial authority. */
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
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const f of rivers) {
    if (state.regional.removedProducts?.has(f.id)) continue;
    const carried = carriedCourse(f);
    const course = courseOf(state, f, carried);
    if (!course) continue;
    courses.push(course);
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
  const cells = courseCells(state, courseLines(feature.geometry));
  if (!cells.length) return null;
  return {
    feature,
    cells,
    discharge: Number(feature.attributes.discharge ?? 0),
    order: Number(feature.attributes.order ?? 1),
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

/** Current and abandoned beds are physical context from the map's retained river objects. */
export function retainedCourseCells(map: PhysicalField) {
  const included = new BitSet(map.mesh.count),
    cells = new CellList(),
    include = (course: readonly number[]) => {
      for (const cell of course)
        if (!included.has(cell)) {
          included.add(cell);
          cells.push(cell);
        }
    };
  for (const reach of reachesOf(map)) {
    include(reach.cells);
    for (const former of reach.former) include(former.cells);
  }
  return cells.finish();
}
