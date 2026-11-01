import { CellList } from "@atlas/domain";
import { generationFeatures } from "../generationFeatures";
import { capturedCourses } from "./courses";
import {
  cellAt,
  clamp,
  gridNeighbors,
  neighbors,
  onFrameEdge,
  regionalComponents,
  spacing,
  type Evidence,
  type RegionalState,
  type Seat,
  type Situation,
} from "./state";

/** An established seat's footprint, as a share of the parent span, held to this hillslope gradient. */
const seatFootprintShare = 0.12;
const seatGradient = 0.03;
/** A proposed village holds only its own cell and the ring around it, more gently. */
const proposedGradient = 0.04;
/** Interpolated captured depth (m) above which ground beside a captured lake is lake. */
const lakeShoreDepth = 0.5;

/**
 * Read the established geography once: captured courses with the discharge they bring across
 * the frame, standing water with its level, inherited summits and the seats of known
 * settlements with their broad situation. Each enters the processes as a term, never as a
 * shape stamped on the result.
 */
export function readEvidence(state: RegionalState): Evidence {
  const courses = capturedCourses(state),
    evidence: Evidence = {
      courses,
      lakes: capturedLakes(state),
      summits: knownSummits(state),
      seats: knownSeats(state),
      entries: riverEntries(state),
    };
  state.courses = courses;
  state.evidence = evidence;
  return evidence;
}

/**
 * Captured standing water. Its extent is read from the interpolated depth rather than the
 * category raster, so the shore follows the parent's depth taper instead of its cell edges;
 * the category decides that the water is a lake and not the sea.
 */
function capturedLakes(state: RegionalState): Evidence["lakes"] {
  const g = state.surface,
    c = g.channels,
    lakes: Evidence["lakes"] = [],
    around = new Int32Array(8);
  if (!c.water) return lakes;
  const lakeWater = (i: number) => {
    if (c.water.get(i) === 1) return false;
    if (c.water.get(i) === 2) return (c.waterDepth?.get(i) ?? 1) > lakeShoreDepth;
    if (!c.waterDepth || c.waterDepth.get(i) <= lakeShoreDepth) return false;
    const m = gridNeighbors(g.width, g.height, i, around);
    for (let k = 0; k < m; k++) if (c.water.get(around[k]) === 2) return true;
    return false;
  };
  regionalComponents(g, lakeWater, (members) => {
    let level = 0,
      weight = 0;
    for (const i of members) {
      level += c.waterLevel?.get(i) ?? state.inheritedHeight.get(i);
      weight++;
    }
    lakes.push({ cells: members, level: level / weight });
  });
  return lakes;
}

/** Inherited significant summits, read from their captured positions. */
function knownSummits(state: RegionalState): Evidence["summits"] {
  const summits: Evidence["summits"] = [];
  for (const f of generationFeatures(state, { areaId: state.input.areaId })) {
    if (f.kind !== "peak" || f.geometry.type !== "Point") continue;
    // A summit an earlier refinement re-anchored is read from its captured position.
    const captured = f.attributes.anchoredFrom as [number, number] | undefined,
      [x, y] = captured ?? f.geometry.coordinates,
      cell = cellAt(state, x, y);
    if (state.surface.channels.water?.get(cell) === 1) continue;
    summits.push({
      featureId: f.id,
      cell,
      prominence: Number(f.attributes.capturedProminence ?? f.attributes.prominence ?? 300),
    });
  }
  return summits;
}

/**
 * Known seats start from their captured position every time this map is refined, so a seat
 * an earlier refinement moved is re-sited from the same evidence, not from its last move.
 */
export function knownSeats(state: RegionalState): Seat[] {
  const seats: Seat[] = [];
  for (const f of generationFeatures(state, { areaId: state.input.areaId })) {
    if (f.kind !== "settlement" || f.geometry.type !== "Point") continue;
    const captured = f.attributes.sitedFrom as [number, number] | undefined,
      [x, y] = captured ?? f.geometry.coordinates,
      cell = cellAt(state, x, y);
    seats.push({
      featureId: f.id,
      cell,
      situation: situationAt(state, cell),
      radius: seatRadius(state),
      gradient: seatGradient,
      strength: "established",
    });
  }
  return seats;
}

export function proposedSeat(state: RegionalState, featureId: string, cell: number): Seat {
  return {
    featureId,
    cell,
    situation: situationAt(state, cell),
    radius: 1,
    gradient: proposedGradient,
    strength: "proposed",
  };
}

export function seatRadius(state: RegionalState) {
  const [dx, dy] = spacing(state.surface);
  return clamp(Math.round((state.parentSpan * seatFootprintShare) / Math.min(dx, dy)), 1, 3);
}

/** A seat's broad situation on the present surface: by the sea, by a lake, by a river, or inland. */
export function situationAt(state: RegionalState, cell: number): Situation {
  const c = state.surface.channels,
    cells = [cell, ...neighbors(state.surface, cell)],
    water = (kind: number) => cells.some((j) => c.water?.get(j) === kind);
  if (water(1)) return "coast";
  if (water(2)) return "lake";
  if (cells.some((j) => (c.riverOrder?.get(j) ?? 0) > 0)) return "river";
  return "inland";
}

/**
 * A captured river crossing the frame edge brings its upstream discharge with it. Each
 * crossing enters at the edge sample carrying the most captured flow where the captured
 * surface descends into the frame.
 */
function riverEntries(state: RegionalState): Evidence["entries"] {
  const g = state.surface,
    c = g.channels,
    entries: Evidence["entries"] = [];
  if (!c.riverOrder || !c.flow) return entries;
  const edge = edgeRing(g.width, g.height),
    flow = (i: number) =>
      c.water?.get(i) !== 1 && c.riverOrder.get(i) > 0 ? Math.max(0, c.flow.get(i)) : 0;
  for (let k = 0; k < edge.length; k++) {
    const i = edge[k],
      before = flow(edge[(k - 1 + edge.length) % edge.length]),
      after = flow(edge[(k + 1) % edge.length]);
    if (flow(i) <= 0 || before > flow(i) || after >= flow(i) || !flowsInward(state, i)) continue;
    entries.push({ cell: i, discharge: flow(i) });
  }
  return entries;
}

/** Frame edge samples in order around the rectangle. */
export function edgeRing(width: number, height: number) {
  const edge = new CellList();
  for (let x = 0; x < width; x++) edge.push(x);
  for (let y = 1; y < height; y++) edge.push(y * width + width - 1);
  for (let x = width - 2; x >= 0; x--) edge.push((height - 1) * width + x);
  for (let y = height - 2; y > 0; y--) edge.push(y * width);
  return edge.finish();
}

/** The captured surface descends from the edge sample into the frame. */
function flowsInward(state: RegionalState, i: number) {
  const g = state.surface,
    h = state.inheritedHeight,
    x = i % g.width,
    y = Math.floor(i / g.width);
  if (!onFrameEdge(g, i)) return false;
  const inner =
    clamp(y + (y === 0 ? 2 : y === g.height - 1 ? -2 : 0), 0, g.height - 1) * g.width +
    clamp(x + (x === 0 ? 2 : x === g.width - 1 ? -2 : 0), 0, g.width - 1);
  return h.get(inner) < h.get(i);
}
