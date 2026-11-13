// Where each landscape landmark kind belongs: the terrain reading a creator would make from
// the map, as a score over the physical field at the epoch the landmark forms in, and the
// geometry the kind lays out once its anchor is chosen.
import type { PhysicalField } from "./field";
import { Landform } from "./codes";
import { meshPoint, nearestTriangle } from "./mesh";
import { metricSearch } from "./metricSearch";
import { physicalSampler } from "./physicalMetric";
import { distance, type Point } from "./landmarkGeometry";
import { CellList, MapScale, SmallIntSet, radixOrder, type Band } from "@atlas/domain";
import { workingArray } from "./physicalNumerics";
import { onRiver, waterAt } from "../water/riverKeeping";

/** The field read once per siting pass. */
export interface Terrain {
  map: PhysicalField;
  /** Metres to the nearest sea cell; Infinity on a field without sea. */
  sea: Band;
  /** Metres to the nearest land cell; Infinity on a field without land. */
  offshore: Band;
  /** Content land cells, ascending; a scan of the mesh, not a resident list. */
  land: Iterable<number>;
  /** Content sea cells, ascending; a scan of the mesh, not a resident list. */
  ocean: Iterable<number>;
  /** River cells, largest flow first, above base level. */
  rivers: Int32Array;
}
export interface Site {
  center: number;
  path: Point[];
}
export interface Rule {
  /** Water kinds choose among river cells, a deep locus among sea cells, the rest among land. */
  pool?: "rivers" | "ocean" | "land";
  /** A score for this anchor, or null when the kind does not belong here. */
  assess(t: Terrain, i: number, p: Record<string, number>): number | null;
  shape(t: Terrain, i: number, p: Record<string, number>): Site;
  /** Fit the seeded measures to the site: a summit above the local base, a cut the plateau allows. */
  fit?(t: Terrain, i: number, p: Record<string, number>): Record<string, number>;
}

/** A little over one cell of this mesh, in kilometres: the least a measured band can span. */
const cellKilometres = (map: PhysicalField) => MapScale.inUnits(map.scale.cells(1.2), "km");
/** Metres above the base level the landmark machinery measures against. */
export const height = (map: PhysicalField, i: number) =>
  MapScale.metres(map.Elevation.get(i) - map.EffectiveSeaLevel, "native");

/** Geodesic metres from every cell to the nearest cell the predicate accepts. */
function distanceTo(map: PhysicalField, accept: (i: number) => boolean) {
  const values = workingArray(map, "float64", "landmark:distance").fill(Infinity);
  function* seeds() {
    for (let i = 0; i < map.mesh.count; i++)
      if (accept(i)) {
        values.set(i, 0);
        yield i;
      }
  }
  metricSearch(map.mesh, seeds(), values, Infinity, () => {});
  return values;
}
export function analyseTerrain(map: PhysicalField): Terrain {
  const sea = distanceTo(map, (i) => map.WaterKindCodes.get(i) === 1),
    offshore = distanceTo(map, (i) => map.WaterKindCodes.get(i) === 0);
  const rivers = new CellList(),
    content = (water: number): Iterable<number> => ({
      *[Symbol.iterator]() {
        for (let i = 0; i < map.mesh.count; i++)
          if (map.mesh.membership(i) === 1 && map.WaterKindCodes.get(i) === water) yield i;
      },
    });
  for (let i = 0; i < map.mesh.count; i++)
    if (
      map.mesh.membership(i) === 1 &&
      map.WaterKindCodes.get(i) === 0 &&
      onRiver(map, i) &&
      height(map, i) > map.scale.length(0.00000125)
    )
      rivers.push(i);
  // Largest flow first; rivers were pushed ascending, so ties keep index order.
  const riverCells = rivers.finish(),
    byFlow = radixOrder(
      Float64Array.from(riverCells, (i) => waterAt(map, i)),
      true
    );
  return {
    map,
    sea,
    offshore,
    land: content(0),
    ocean: content(1),
    rivers: Int32Array.from(byFlow, (k) => riverCells[k]),
  };
}

/** Cells within the radius of a centre, found through the mesh rather than by scanning it. */
export function within(map: PhysicalField, centre: number, radius: number) {
  const at: Point = [map.mesh.x(centre), map.mesh.y(centre)],
    cells = [centre],
    seen = new SmallIntSet();
  seen.add(centre);
  for (let head = 0; head < cells.length; head++) {
    const i = cells[head];
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j < 0 || seen.has(j) || distance(map, j, at) > radius) continue;
      seen.add(j);
      cells.push(j);
    }
  }
  return cells;
}
/** Metres between the highest and lowest of these cells. */
export function relief(map: PhysicalField, cells: number[]) {
  let low = Infinity,
    high = -Infinity;
  for (const i of cells) {
    const elevation = map.Elevation.get(i);
    low = Math.min(low, elevation);
    high = Math.max(high, elevation);
  }
  return MapScale.metres(high - low, "native");
}
/** Mean height of these cells above base level. */
export function baseHeight(map: PhysicalField, cells: number[]) {
  return cells.reduce((sum, i) => sum + height(map, i), 0) / Math.max(1, cells.length);
}
/** The unit direction toward the lowest ground at this span, and the drop to it in metres. */
function downhill(t: Terrain, i: number, span: number) {
  const { map } = t,
    at = physicalSampler(map.mesh, map.Elevation),
    here = map.Elevation.get(i);
  let best: Point = [1, 0],
    drop = 0;
  for (let k = 0; k < 8; k++) {
    const angle = (k * Math.PI) / 4,
      [x, y] = meshPoint(
        map.mesh,
        map.mesh.x(i) + Math.cos(angle) * span,
        map.mesh.y(i) + Math.sin(angle) * span
      ),
      fall = MapScale.metres(here - at(x, y), "native");
    if (fall > drop) {
      drop = fall;
      best = [Math.cos(angle), Math.sin(angle)];
    }
  }
  return { direction: best, drop };
}
/** Three points from `from` along a direction, shortened while the far end lies in the sea. */
function landPath(t: Terrain, from: Point, [dx, dy]: Point, length: number): Point[] {
  const { map } = t,
    point = (span: number) => meshPoint(map.mesh, from[0] + dx * span, from[1] + dy * span),
    sea = ([x, y]: Point) => {
      const i = nearestTriangle(map.mesh, x, y);
      return i < 0 || map.WaterKindCodes.get(i) !== 0;
    };
  let span = length;
  while (span > length / 4 && (sea(point(span)) || sea(point(span / 2)))) span *= 0.8;
  return [from, point(span / 2), point(span)];
}
const point = (t: Terrain, i: number): Site => ({
  center: i,
  path: [[t.map.mesh.x(i), t.map.mesh.y(i)]],
});
/** The river's drop into the cell it flows to, in metres. */
function stepDown(map: PhysicalField, i: number) {
  const target = map.FlowTargets.get(i);
  return target >= 0
    ? Math.max(0, MapScale.metres(map.Elevation.get(i) - map.Elevation.get(target), "native"))
    : 0;
}
/** Whether the river at this cell reaches the sea within this many cells downstream. */
function reachesSea(map: PhysicalField, i: number, steps: number) {
  let at = i;
  for (let n = 0; n < steps && at >= 0; n++) {
    at = map.FlowTargets.get(at);
    if (at >= 0 && map.WaterKindCodes.get(at) === 1) return true;
  }
  return false;
}
/** The nearest great river to an anchor within reach: its cell, or -1. */
function riverNear(t: Terrain, i: number, reach: number) {
  const at: Point = [t.map.mesh.x(i), t.map.mesh.y(i)];
  // Rivers are sorted by flow, so the first within reach is the largest.
  for (const r of t.rivers) if (distance(t.map, r, at) <= reach) return r;
  return -1;
}

/* ---------- kinds ---------- */

function mountain(volcanic: boolean): Rule {
  const limitShare = volcanic ? 0.0001 : 0.000075,
    ceilingShare = volcanic ? 0.000375 : 0.00025;
  return {
    assess(t, i, p) {
      const r = MapScale.metres(p.baseRadius, "km"),
        limit = t.map.scale.length(limitShare),
        ceiling = t.map.scale.length(ceilingShare),
        h = height(t.map, i);
      if (t.sea.get(i) < 1.5 * r || h < 0 || h > ceiling) return null;
      const rough = relief(t.map, within(t.map, i, r));
      if (rough > limit) return null;
      const heat = volcanic ? 0.3 * Math.min(1, t.map.HeatSourceDensity.get(i) / 500) : 0;
      return 1 - rough / limit + 0.5 * (1 - h / ceiling) + heat;
    },
    shape: point,
    fit(t, i, p) {
      const base = baseHeight(t.map, within(t.map, i, MapScale.metres(p.baseRadius, "km")));
      return { ...p, summit: Math.round(base + p.prominence) };
    },
  };
}
function ring(impact: boolean): Rule {
  const limitShare = impact ? 0.000125 : 0.0000375;
  return {
    assess(t, i, p) {
      const r = MapScale.metres(p.diameter, "km") / 2,
        limit = t.map.scale.length(limitShare),
        h = height(t.map, i);
      if (
        t.sea.get(i) < (impact ? 1 : 1.5) * r ||
        h < 0 ||
        (!impact && h > t.map.scale.length(0.0003))
      )
        return null;
      const rough = relief(t.map, within(t.map, i, r));
      if (rough > limit) return null;
      const bonus = impact
        ? 0.3 * (1 - Math.min(1, h / t.map.scale.length(0.0005)))
        : 0.5 * (1 - Math.min(1000, t.map.Moisture.get(i)) / 1000);
      return 1 - rough / limit + bonus;
    },
    shape: point,
    // A ring structure spans several cells of the mesh it is sited on, so its bands are real.
    fit: (t, _i, p) => ({ ...p, diameter: Math.max(p.diameter, 4 * cellKilometres(t.map)) }),
  };
}
const escarpment: Rule = {
  assess(t, i, p) {
    const w = MapScale.metres(p.scarpWidth, "km"),
      h = height(t.map, i);
    if (t.sea.get(i) < 2 * w || h < t.map.scale.length(0.000075)) return null;
    const { drop } = downhill(t, i, 3 * w);
    return drop < t.map.scale.length(0.0000375)
      ? null
      : drop / t.map.scale.length(0.00025) + h / t.map.scale.length(0.00075);
  },
  shape(t, i, p) {
    const w = MapScale.metres(p.scarpWidth, "km"),
      length = Math.max(6 * w, t.map.scale.length(0.0375)),
      {
        direction: [ux, uy],
      } = downhill(t, i, 3 * w),
      // The right-hand side of the drawn line drops, so the line runs across the fall.
      along: Point = [-uy, ux],
      from = meshPoint(
        t.map.mesh,
        t.map.mesh.x(i) - (along[0] * length) / 2,
        t.map.mesh.y(i) - (along[1] * length) / 2
      );
    return { center: i, path: landPath(t, from, along, length) };
  },
  fit(t, i, p) {
    return {
      ...p,
      scarpWidth: Math.max(p.scarpWidth, cellKilometres(t.map)),
      throw: Math.round(
        Math.min(p.throw, Math.max(t.map.scale.length(0.000025), 1.5 * height(t.map, i)))
      ),
    };
  },
};
const canyon: Rule = {
  assess(t, i, p) {
    const w = MapScale.metres(p.rimWidth, "km"),
      h = height(t.map, i);
    if (
      h < t.map.scale.length(0.000075) ||
      t.sea.get(i) < Math.max(3 * w, t.map.scale.length(0.025))
    )
      return null;
    const rough = relief(t.map, within(t.map, i, 2 * w));
    if (rough > t.map.scale.length(0.0001)) return null;
    const river = riverNear(t, i, MapScale.metres(p.captureDistance, "km"));
    const flow = river >= 0 ? 1 + Math.log10(1 + waterAt(t.map, river)) / 10 : 0;
    return 1 - rough / t.map.scale.length(0.0001) + flow;
  },
  shape(t, i, p) {
    const w = MapScale.metres(p.rimWidth, "km"),
      length = Math.max(8 * w, t.map.scale.length(0.0375)),
      { direction } = downhill(t, i, length / 2);
    return { center: i, path: landPath(t, [t.map.mesh.x(i), t.map.mesh.y(i)], direction, length) };
  },
  fit(t, i, p) {
    return {
      ...p,
      rimWidth: Math.max(p.rimWidth, cellKilometres(t.map)),
      depth: Math.round(Math.min(p.depth, 0.8 * height(t.map, i))),
    };
  },
};
const falls: Rule = {
  pool: "rivers",
  assess(t, i, p) {
    const h = height(t.map, i),
      steps = Math.ceil(t.map.scale.cellCount(MapScale.metres(p.captureDistance, "km")));
    if (
      h < t.map.scale.length(0.0000375) ||
      t.sea.get(i) < t.map.scale.length(0.0125) ||
      reachesSea(t.map, i, steps)
    )
      return null;
    return Math.log10(1 + waterAt(t.map, i)) + stepDown(t.map, i) / t.map.scale.length(0.000025);
  },
  shape: point,
  fit(t, i, p) {
    return { ...p, drop: Math.round(Math.min(p.drop, 0.5 * height(t.map, i))) };
  },
};

/* ---------- great magic sources ---------- */

/** A source is sited where its system's own medium is strongest; the reach stays a cell wide. */
function source(
  pool: Rule["pool"],
  assess: (t: Terrain, i: number, p: Record<string, number>) => number | null
): Rule {
  return {
    pool,
    assess,
    shape: point,
    fit: (t, _i, p) => ({ ...p, reach: Math.max(p.reach, cellKilometres(t.map)) }),
  };
}
// Every magic rule scans its whole pool and always ranks: a system that is generated always
// has a best site, the strongest medium first and the plainest ground last.
const wellspring = source("land", (t, i) => {
  const heat = t.map.HeatSourceDensity.get(i);
  return (heat >= 300 ? 2 : 0) + heat / 1000 + t.map.FractureConductance.get(i) / 1000;
});
const vault = source("land", (t, i) => {
  const ice = t.map.IceThickness.get(i),
    h = height(t.map, i);
  return (
    (ice > 0 ? 2 : 0) +
    ice / t.map.scale.length(0.00025) +
    h / t.map.scale.length(0.001) +
    (1000 - t.map.Temperature.get(i)) / 1000
  );
});
const locus = source("ocean", (t, i) => {
  const depth = MapScale.metres(t.map.WaterDepths.get(i), "native"),
    offshore = t.offshore.get(i);
  if (offshore < t.map.scale.cells(1)) return null;
  return (
    (depth >= t.map.scale.length(0.000375) ? 2 : 0) +
    depth / t.map.scale.length(0.0015) +
    Math.min(1, offshore / t.map.scale.length(0.075))
  );
});
const heartwood = source("land", (t, i) => {
  const cover = t.map.TreeCover.get(i),
    moisture = t.map.Moisture.get(i);
  return (
    (cover >= 0.4 && moisture >= 500 ? 2 : 0) + cover + moisture / 1000 - t.map.Slope.get(i) * 50
  );
});
const pan = source("land", (t, i) => {
  const moisture = t.map.Moisture.get(i),
    dry = Math.max(0, 1 - moisture / 1000),
    lake = t.map.LakeMemory.get(i) > 0,
    basin = lake || t.map.LandformCodes.get(i) === Landform.Basin,
    flat =
      relief(t.map, within(t.map, i, t.map.scale.length(0.0075))) <= t.map.scale.length(0.0000375);
  return (moisture <= 400 && basin ? 2 : 0) + dry + (lake ? 0.5 : 0) + (flat ? 0.3 : 0);
});

export const sitingRules: Record<string, Rule> = {
  "volcanic-mountain": mountain(true),
  "resistant-mountain": mountain(false),
  "dome-ring": ring(false),
  "impact-ring": ring(true),
  escarpment,
  canyon,
  falls,
  "fire-wellspring": wellspring,
  "aurora-vault": vault,
  "pressure-locus": locus,
  "greenwood-heart": heartwood,
  "salt-pan": pan,
};
