// Where each landscape landmark kind belongs: the terrain reading a creator would make from
// the map, as a score over the physical field at the epoch the landmark forms in, and the
// geometry the kind lays out once its anchor is chosen.
import type { PhysicalField } from "./field";
import { Landform } from "./codes";
import { meshPoint, nearestTriangle } from "./mesh";
import { metricSearch } from "./metricSearch";
import { physicalSampler } from "./physicalMetric";
import { distance, type Point } from "./landmarkGeometry";
import { CellList, radixOrder, type NumericalVector } from "@atlas/domain";
import { workingArray } from "./physicalNumerics";

/** The field read once per siting pass. */
export interface Terrain {
  map: PhysicalField;
  /** Metres to the nearest sea cell; Infinity on a field without sea. */
  sea: NumericalVector;
  /** Metres to the nearest land cell; Infinity on a field without land. */
  offshore: NumericalVector;
  /** Content land cells. */
  land: NumericalVector;
  /** Content sea cells. */
  ocean: NumericalVector;
  /** River cells, largest flow first, above base level. */
  rivers: NumericalVector;
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

const km = 1000;
/** A little over one cell of this mesh, in kilometres: the least a measured band can span. */
const cellKilometres = (map: PhysicalField) => (map.mesh.spacing * 1.2) / km;
/** Metres above the base level the landmark machinery measures against. */
export const height = (map: PhysicalField, i: number) =>
  (map.Elevation[i] - map.EffectiveSeaLevel) / 1024;

/** Geodesic metres from every cell to the nearest cell the predicate accepts. */
function distanceTo(map: PhysicalField, accept: (i: number) => boolean) {
  const values = workingArray(map, "float64", "landmark:distance").fill(Infinity);
  function* seeds() {
    for (let i = 0; i < map.mesh.count; i++)
      if (accept(i)) {
        values[i] = 0;
        yield i;
      }
  }
  metricSearch(map.mesh, seeds(), values, Infinity, () => {});
  return values;
}
export function analyseTerrain(map: PhysicalField): Terrain {
  const sea = distanceTo(map, (i) => map.WaterKindCodes[i] === 1),
    offshore = distanceTo(map, (i) => map.WaterKindCodes[i] === 0);
  const land = new CellList(),
    ocean = new CellList(),
    rivers = new CellList();
  for (let i = 0; i < map.mesh.contentCount; i++) {
    if (map.WaterKindCodes[i] === 1) ocean.push(i);
    if (map.WaterKindCodes[i] !== 0) continue;
    land.push(i);
    if (map.RiverOrders[i] > 0 && height(map, i) > 5) rivers.push(i);
  }
  // Largest flow first; rivers were pushed ascending, so ties keep index order.
  const riverCells = rivers.finish(),
    byFlow = radixOrder(
      Float64Array.from(riverCells, (i) => map.FlowAccumulation[i]),
      true
    );
  return {
    map,
    sea,
    offshore,
    land: land.finish(),
    ocean: ocean.finish(),
    rivers: Int32Array.from(byFlow, (k) => riverCells[k]),
  };
}

/** Cells within the radius of a centre, found through the mesh rather than by scanning it. */
export function within(map: PhysicalField, centre: number, radius: number) {
  const at: Point = [map.mesh.x[centre], map.mesh.y[centre]],
    cells = [centre],
    seen = new Set(cells);
  for (let head = 0; head < cells.length; head++) {
    const i = cells[head];
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
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
    low = Math.min(low, map.Elevation[i]);
    high = Math.max(high, map.Elevation[i]);
  }
  return (high - low) / 1024;
}
/** Mean height of these cells above base level. */
export function baseHeight(map: PhysicalField, cells: number[]) {
  return cells.reduce((sum, i) => sum + height(map, i), 0) / Math.max(1, cells.length);
}
/** The unit direction toward the lowest ground at this span, and the drop to it in metres. */
function downhill(t: Terrain, i: number, span: number) {
  const { map } = t,
    at = physicalSampler(map.mesh, map.Elevation),
    here = map.Elevation[i];
  let best: Point = [1, 0],
    drop = 0;
  for (let k = 0; k < 8; k++) {
    const angle = (k * Math.PI) / 4,
      [x, y] = meshPoint(
        map.mesh,
        map.mesh.x[i] + Math.cos(angle) * span,
        map.mesh.y[i] + Math.sin(angle) * span
      ),
      fall = (here - at(x, y)) / 1024;
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
      return i < 0 || map.WaterKindCodes[i] !== 0;
    };
  let span = length;
  while (span > length / 4 && (sea(point(span)) || sea(point(span / 2)))) span *= 0.8;
  return [from, point(span / 2), point(span)];
}
const point = (t: Terrain, i: number): Site => ({
  center: i,
  path: [[t.map.mesh.x[i], t.map.mesh.y[i]]],
});
/** The river's drop into the cell it flows to, in metres. */
function stepDown(map: PhysicalField, i: number) {
  const target = map.FlowTargets[i];
  return target >= 0 ? Math.max(0, (map.Elevation[i] - map.Elevation[target]) / 1024) : 0;
}
/** Whether the river at this cell reaches the sea within this many cells downstream. */
function reachesSea(map: PhysicalField, i: number, steps: number) {
  let at = i;
  for (let n = 0; n < steps && at >= 0; n++) {
    at = map.FlowTargets[at];
    if (at >= 0 && map.WaterKindCodes[at] === 1) return true;
  }
  return false;
}
/** The nearest great river to an anchor within reach: its cell, or -1. */
function riverNear(t: Terrain, i: number, reach: number) {
  const at: Point = [t.map.mesh.x[i], t.map.mesh.y[i]];
  // Rivers are sorted by flow, so the first within reach is the largest.
  for (const r of t.rivers) if (distance(t.map, r, at) <= reach) return r;
  return -1;
}

/* ---------- kinds ---------- */

function mountain(volcanic: boolean): Rule {
  const limit = volcanic ? 400 : 300,
    ceiling = volcanic ? 1500 : 1000;
  return {
    assess(t, i, p) {
      const r = p.baseRadius * km,
        h = height(t.map, i);
      if (t.sea[i] < 1.5 * r || h < 0 || h > ceiling) return null;
      const rough = relief(t.map, within(t.map, i, r));
      if (rough > limit) return null;
      const heat = volcanic ? 0.3 * Math.min(1, t.map.HeatSourceDensity[i] / 500) : 0;
      return 1 - rough / limit + 0.5 * (1 - h / ceiling) + heat;
    },
    shape: point,
    fit(t, i, p) {
      const base = baseHeight(t.map, within(t.map, i, p.baseRadius * km));
      return { ...p, summit: Math.round(base + p.prominence) };
    },
  };
}
function ring(impact: boolean): Rule {
  const limit = impact ? 500 : 150;
  return {
    assess(t, i, p) {
      const r = (p.diameter * km) / 2,
        h = height(t.map, i);
      if (t.sea[i] < (impact ? 1 : 1.5) * r || h < 0 || (!impact && h > 1200)) return null;
      const rough = relief(t.map, within(t.map, i, r));
      if (rough > limit) return null;
      const bonus = impact
        ? 0.3 * (1 - Math.min(h, 2000) / 2000)
        : 0.5 * (1 - Math.min(1000, t.map.Moisture[i]) / 1000);
      return 1 - rough / limit + bonus;
    },
    shape: point,
    // A ring structure spans several cells of the mesh it is sited on, so its bands are real.
    fit: (t, _i, p) => ({ ...p, diameter: Math.max(p.diameter, 4 * cellKilometres(t.map)) }),
  };
}
const escarpment: Rule = {
  assess(t, i, p) {
    const w = p.scarpWidth * km,
      h = height(t.map, i);
    if (t.sea[i] < 2 * w || h < 300) return null;
    const { drop } = downhill(t, i, 3 * w);
    return drop < 150 ? null : drop / 1000 + h / 3000;
  },
  shape(t, i, p) {
    const w = p.scarpWidth * km,
      length = Math.max(6 * w, 150 * km),
      {
        direction: [ux, uy],
      } = downhill(t, i, 3 * w),
      // The right-hand side of the drawn line drops, so the line runs across the fall.
      along: Point = [-uy, ux],
      from = meshPoint(
        t.map.mesh,
        t.map.mesh.x[i] - (along[0] * length) / 2,
        t.map.mesh.y[i] - (along[1] * length) / 2
      );
    return { center: i, path: landPath(t, from, along, length) };
  },
  fit(t, i, p) {
    return {
      ...p,
      scarpWidth: Math.max(p.scarpWidth, cellKilometres(t.map)),
      throw: Math.round(Math.min(p.throw, Math.max(100, 1.5 * height(t.map, i)))),
    };
  },
};
const canyon: Rule = {
  assess(t, i, p) {
    const w = p.rimWidth * km,
      h = height(t.map, i);
    if (h < 300 || t.sea[i] < Math.max(3 * w, 100 * km)) return null;
    const rough = relief(t.map, within(t.map, i, 2 * w));
    if (rough > 400) return null;
    const river = riverNear(t, i, p.captureDistance * km);
    const flow = river >= 0 ? 1 + Math.log10(1 + t.map.FlowAccumulation[river]) / 10 : 0;
    return 1 - rough / 400 + flow;
  },
  shape(t, i, p) {
    const w = p.rimWidth * km,
      length = Math.max(8 * w, 150 * km),
      { direction } = downhill(t, i, length / 2);
    return { center: i, path: landPath(t, [t.map.mesh.x[i], t.map.mesh.y[i]], direction, length) };
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
      steps = Math.ceil((p.captureDistance * km) / t.map.mesh.spacing);
    if (h < 150 || t.sea[i] < 50 * km || reachesSea(t.map, i, steps)) return null;
    return Math.log10(1 + t.map.FlowAccumulation[i]) + stepDown(t.map, i) / 100;
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
  const heat = t.map.HeatSourceDensity[i];
  return (heat >= 300 ? 2 : 0) + heat / 1000 + t.map.FractureConductance[i] / 1000;
});
const vault = source("land", (t, i) => {
  const ice = t.map.IceThickness[i],
    h = height(t.map, i);
  return (ice > 0 ? 2 : 0) + ice / 1000 + h / 4000 + (1000 - t.map.Temperature[i]) / 1000;
});
const locus = source("ocean", (t, i) => {
  const depth = t.map.WaterDepths[i] / 1024;
  if (t.offshore[i] < t.map.mesh.spacing) return null;
  return (depth >= 1500 ? 2 : 0) + depth / 6000 + Math.min(1, t.offshore[i] / (300 * km));
});
const heartwood = source("land", (t, i) => {
  const cover = t.map.TreeCover[i],
    moisture = t.map.Moisture[i];
  return (cover >= 0.4 && moisture >= 500 ? 2 : 0) + cover + moisture / 1000 - t.map.Slope[i] * 50;
});
const pan = source("land", (t, i) => {
  const dry = Math.max(0, 1 - t.map.Moisture[i] / 1000),
    lake = t.map.LakeMemory[i] > 0,
    basin = lake || t.map.LandformCodes[i] === Landform.Basin,
    flat = relief(t.map, within(t.map, i, 30 * km)) <= 150;
  return (t.map.Moisture[i] <= 400 && basin ? 2 : 0) + dry + (lake ? 0.5 : 0) + (flat ? 0.3 : 0);
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
