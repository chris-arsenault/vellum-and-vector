import { defaultLandmarkParameters, landmarkKind } from "@atlas/domain";
import {
  nearestOnPath,
  pathMetrics,
  placeLandmark,
  type Placed,
} from "../../world/landmarkGeometry";
import { analyseTerrain, sitingRules } from "../../world/landmarkSitingRules";
import { physicalSampler } from "../../world/physicalMetric";
import { regionEvidence } from "../../world/worldRegionEvidence";
import type { GenerationState } from "../../process";
import type { RegionalState } from "../../regional/state";
import { parentSpanOf } from "../poiCarry";
import type { PoiCarried, PoiFate, PoiFieldChange, PoiPlace } from "../poiContract";
import {
  cellSpan,
  cellsWithin,
  fieldOf,
  gap,
  heldFor,
  isLand,
  magicValue,
  metres,
  nearestWhere,
} from "../poiReads";

type IsA = (state: GenerationState, cell: number) => boolean;

/** What the relief entries share. Nothing here computes geography the generator does not. */

/** A fixed number of this map's cell spans, as a reach. */
export const spans = (count: number) => (state: GenerationState) => count * cellSpan(state);

const elevationAt = (state: GenerationState) =>
  heldFor(state, "relief:elevation", () => {
    const map = fieldOf(state);
    return physicalSampler(map.mesh, map.Elevation);
  });
/** Heights on a ring of sixteen directions around a cell. */
export function ringHeights(state: GenerationState, cell: number, radius: number) {
  const mesh = fieldOf(state).mesh,
    at = elevationAt(state),
    values: number[] = [];
  for (let direction = 0; direction < 16; direction++) {
    const angle = (direction * Math.PI) / 8;
    values.push(
      at(mesh.x(cell) + Math.cos(angle) * radius, mesh.y(cell) + Math.sin(angle) * radius)
    );
  }
  return values;
}
/** The ring two cells out: nearer samples interpolate the cell's own height. */
export const sectionRadius = spans(2);
const fallOn = (here: number, a: number, b: number) =>
  Number.isFinite(a) && Number.isFinite(b) ? Math.min(here - a, here - b) : -Infinity;
export interface Section {
  /** Metres the ground falls on both sides of the cross-section where it falls most. */
  crest: number;
  /** Metres it falls on both sides square to that section: small on a crest, large on a cone. */
  along: number;
  /** Metres the lower flank stands above the cell, on the section where that is greatest. */
  trough: number;
}
/** The shape of the ground through a cell, on this map's own lattice. */
export function sectionAt(state: GenerationState, cell: number): Section {
  const here = fieldOf(state).Elevation.get(cell),
    ring = ringHeights(state, cell, sectionRadius(state));
  let crest = -Infinity,
    axis = 0,
    trough = -Infinity;
  for (let direction = 0; direction < 8; direction++) {
    const fall = fallOn(here, ring[direction], ring[direction + 8]);
    if (fall > crest) [crest, axis] = [fall, direction];
    trough = Math.max(trough, fallOn(-here, -ring[direction], -ring[direction + 8]));
  }
  const along = fallOn(here, ring[(axis + 4) % 16], ring[(axis + 12) % 16]);
  return { crest: metres(crest), along: metres(along), trough: metres(trough) };
}

/** The world's landmark records of a kind, placed on this map's lattice. */
export const landmarksOf = (state: GenerationState, kind: string): readonly Placed[] =>
  heldFor(state, `relief:landmarks:${kind}`, () => {
    const placed: Placed[] = [];
    for (const landmark of state.domain.world.landmarks ?? [])
      if (landmark.kind === kind) {
        const here = placeLandmark(fieldOf(state), landmark);
        if (here) placed.push(here);
      }
    return placed;
  });
/** The content cells within a record's reach of its drawn geometry, each with its record. */
export const landmarkGround = (
  state: GenerationState,
  kind: string,
  reach: (placed: Placed) => number
) =>
  heldFor(state, `relief:ground:${kind}`, () => {
    const map = fieldOf(state),
      mesh = map.mesh,
      ground = new Map<number, Placed>();
    for (const placed of landmarksOf(state, kind)) {
      const metrics = pathMetrics(map, placed.path),
        radius = reach(placed);
      for (let i = 0; i < mesh.count; i++)
        if (
          mesh.membership(i) === 1 &&
          nearestOnPath(map, metrics, mesh.x(i), mesh.y(i)).distance <= radius
        )
          ground.set(i, placed);
    }
    return ground;
  });

const terrainRead = (state: GenerationState) =>
  heldFor(state, "relief:terrain", () => analyseTerrain(fieldOf(state)));
function sitingScore(state: GenerationState, kind: string, cell: number) {
  const declared = landmarkKind(kind);
  if (!declared) return null;
  return sitingRules[kind].assess(terrainRead(state), cell, defaultLandmarkParameters(declared));
}
/** Whether the generator's own siting rule for a landmark kind admits a cell. */
export const sitingAdmits = (kind: string) => (state: GenerationState, cell: number) =>
  sitingScore(state, kind, cell) !== null;
/** The generator's own siting score for a landmark kind, into [0, 1]. */
export const sitingSuits = (kind: string) => (state: GenerationState, cell: number) => {
  const score = sitingScore(state, kind, cell) ?? 0;
  return score > 0 ? score / (score + 1) : 0;
};

/** The generator's own measures of a place's cells, kept for this state. */
const evidenceOf = (state: GenerationState, place: PoiPlace) =>
  heldFor(state, `relief:evidence:${place.id}`, () => regionEvidence(fieldOf(state), place.cells));
export const areaOf = (state: GenerationState, place: PoiPlace) => evidenceOf(state, place).area;
export const lengthOf = (state: GenerationState, place: PoiPlace) => evidenceOf(state, place).span;
export const reliefOf = (state: GenerationState, place: PoiPlace) =>
  evidenceOf(state, place).relief;
/** A magic system's strength at a place's anchor, in [0, 1]. */
export const strengthOf = (system: string) => (state: GenerationState, place: PoiPlace) =>
  magicValue(state, system, "intensity", place.anchor) / 1000;
export const meanOf =
  (...factors: ((state: GenerationState, place: PoiPlace) => number)[]) =>
  (state: GenerationState, place: PoiPlace) =>
    factors.reduce((sum, factor) => sum + factor(state, place), 0) / factors.length;

/** How alone a cell is among others of its kind: half when the nearest lies at `reach` metres. */
export const aloneWithin =
  (isA: IsA, reach: (state: GenerationState) => number) =>
  (state: GenerationState, place: PoiPlace) => {
    const radius = reach(state),
      nearest = nearestWhere(
        state,
        place.anchor,
        radius,
        (cell) => cell !== place.anchor && isA(state, cell)
      ),
      d = nearest < 0 ? radius : gap(state, place.anchor, nearest);
    return d / (d + radius);
  };

const bareBands = ["BroadleafCover", "ConiferCover", "TreeCover", "GrassCover"] as const;
/** Nothing grows on these cells. */
export const bareOf = (cells: readonly number[]): readonly PoiFieldChange[] =>
  cells.flatMap((cell) =>
    bareBands.map((band): PoiFieldChange => ({ change: "atMost", band, cell, value: 0 }))
  );
/** Metres of soil a sheet of hard rock holds on its joints. */
const thinSoil = 0.5;
/** A hard sheet's soil stays thin. */
export const thinSoilOf = (cells: readonly number[]): readonly PoiFieldChange[] =>
  cells.map((cell) => ({ change: "atMost", band: "SoilDepth", cell, value: thinSoil }));
/** Holds the gradient these cells read now, so finer relief cannot steepen them. */
export const holdGradient = (
  state: GenerationState,
  cells: readonly number[],
  ceiling = Infinity
): readonly PoiFieldChange[] => {
  const map = fieldOf(state);
  return cells.map((cell) => ({
    change: "gradientAtMost",
    cell,
    gradient: Math.min(ceiling, map.Slope.get(cell)),
  }));
};

const capturedAt = (state: RegionalState, carried: PoiCarried) =>
  state.regional.inheritedHeight.get(carried.cell);
/** The finer ground at a cell stands at least as high as the parent's place stood. */
export const raisedAsCaptured = (
  state: RegionalState,
  carried: PoiCarried,
  cell: number
): readonly PoiFieldChange[] =>
  cell < 0 || !isLand(state, cell)
    ? []
    : [{ change: "atLeast", band: "Elevation", cell, value: capturedAt(state, carried) }];
/** The finer ground at a cell lies no higher than the parent's place lay. */
export const loweredAsCaptured = (
  state: RegionalState,
  carried: PoiCarried,
  cell: number
): readonly PoiFieldChange[] =>
  cell < 0 || !isLand(state, cell)
    ? []
    : [{ change: "atMost", band: "Elevation", cell, value: capturedAt(state, carried) }];

function extremeNear(state: RegionalState, cell: number, sign: 1 | -1) {
  const map = fieldOf(state);
  let best = cell;
  for (const other of cellsWithin(state, cell, parentSpanOf(state)))
    if (sign * map.Elevation.get(other) > sign * map.Elevation.get(best)) best = other;
  return best;
}
/** The developed top or floor within a parent's cell span of a cell. */
export const highestNear = (state: RegionalState, cell: number) => extremeNear(state, cell, 1);
export const lowestNear = (state: RegionalState, cell: number) => extremeNear(state, cell, -1);

/** The nearest cell of the kind on the child, or the finer ground's own top where none reads so. */
export const nearestOrTop =
  (isA: IsA) =>
  (state: RegionalState, carried: PoiCarried): number => {
    const found = nearestWhere(state, carried.cell, parentSpanOf(state), (cell) =>
      isA(state, cell)
    );
    return found >= 0 ? found : highestNear(state, carried.cell);
  };
/** The nearest cell of the kind on the child, or the finer ground's own floor where none reads so. */
export const nearestOrFloor =
  (isA: IsA) =>
  (state: RegionalState, carried: PoiCarried): number => {
    const found = nearestWhere(state, carried.cell, parentSpanOf(state), (cell) =>
      isA(state, cell)
    );
    return found >= 0 ? found : lowestNear(state, carried.cell);
  };

/** A place that lasts while its cell still reads as its kind, and leaves something when it ends. */
export const lastsWhile =
  (isA: IsA, leaves?: PoiPlace["kind"]) =>
  (state: GenerationState, place: PoiPlace): PoiFate =>
    isA(state, place.anchor)
      ? { fate: "persists" }
      : leaves
        ? { fate: "ends", leaves }
        : { fate: "ends" };
/** Two places at one spot. */
export const sameSpot = (_state: GenerationState, a: PoiPlace, b: PoiPlace) =>
  a.anchor === b.anchor;
/** A place standing inside another's cells. */
export const standsIn = (_state: GenerationState, a: PoiPlace, b: PoiPlace) =>
  b.cells.includes(a.anchor);
