import {
  fieldContour,
  fieldInterpolator,
  gridPosition,
  point,
  regularContourSupport,
  resolutionCells,
  spatial,
  type Band,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import { Landform as L } from "../canonry/codes";
import { topographicProminence } from "../topographicProminence";
import { physicalProfile } from "../canonry/profile";
import { regionalBoundary } from "./drainage";
import { putRefinementFeature } from "./features";
import { measureRegionalRelief } from "./landformRelief";
import {
  channel,
  distance,
  neighbors,
  regionalComponents,
  spacing,
  type RefinementState,
} from "./state";

/** A regional named summit or col needs measurable vertical separation. */
const minimumProminence = 50;
/** Mountain country combines elevation and relief; a high flat plateau is not a range. */
const mountainRelief = 150;
const mountainElevation = 300;
/** A valley needs opposing flanks above its floor, not merely a blue channel. */
const minimumValleyDepth = 30;
/** The summit's upper body supplies its physical naming footprint. */
const summitBodyShare = 0.5;
/** A knickpoint must be markedly steeper than both adjacent reaches. */
const knickpointContrast = 3;

export function extractRegionalLandforms(state: RefinementState) {
  const g = state.surface,
    ridge = measureRegionalRelief(state),
    landform = channel(state, "landform", "category"),
    mountain = g.coverage.scratch("float64", "regional:mountain", g.active.length),
    valleys = g.coverage.scratch("float64", "regional:valleys", g.active.length),
    datum = g.channels.seaLevel?.get(0) ?? 0;
  for (let i = 0; i < g.active.length; i++) {
    landform.set(i, classify(state, i, ridge.get(i)));
    if (g.channels.water.get(i) !== 0) continue;
    const relief = g.channels.localRelief.get(i),
      height = g.channels.elevation.get(i) - datum;
    mountain.set(i, Number(relief >= mountainRelief && height >= mountainElevation));
    valleys.set(i, Number(g.channels.valleyDepth.get(i) >= minimumValleyDepth));
  }
  extractSummits(state, ridge);
  publishReliefAreas(state, "range", mountain);
  publishReliefAreas(state, "valley", valleys);
  extractWaterfalls(state);
  for (const band of [ridge, mountain, valleys]) g.coverage.release(band);
}

function classify(state: RefinementState, i: number, ridge: number) {
  const c = state.surface.channels;
  if (c.water.get(i) === 1) return L.Seabed;
  if (c.water.get(i) === 2) return L.Basin;
  if (c.valleyDepth.get(i) >= minimumValleyDepth) return L.Valley;
  if (ridge >= minimumValleyDepth) return L.Ridge;
  return c.slope.get(i) < 0.012 ? L.Plain : L.Slope;
}

function extractSummits(state: RefinementState, ridge: Band) {
  const g = state.surface,
    { rise, saddle } = topographicProminence(
      g.coverage,
      g.channels.elevation,
      (i) => neighbors(g, i),
      g.channels.seaLevel?.get(0) ?? 0
    ),
    passes = new Set<number>();
  for (let i = 0; i < g.active.length; i++) {
    if (rise.get(i) < minimumProminence || regionalBoundary(state, i) || g.channels.water.get(i))
      continue;
    g.channels.landform.set(i, L.Peak);
    if (!resolvedSummit(state, i, rise.get(i))) continue;
    putRefinementFeature(state, `peak:${i}`, "peak", "geology", point(gridPosition(g, i)), {
      prominence: rise.get(i),
      elevation: g.channels.elevation.get(i),
      geometryMeaning: "prominent summit",
    });
    const col = saddle.get(i);
    if (!usableCol(state, col, ridge, passes)) continue;
    passes.add(col);
    g.channels.landform.set(col, L.Pass);
    putRefinementFeature(state, `pass:${col}`, "pass", "geology", point(gridPosition(g, col)), {
      elevation: g.channels.elevation.get(col),
      geometryMeaning: "joining col between summits",
    });
  }
  g.coverage.release(rise);
  g.coverage.release(saddle);
}

function usableCol(state: RefinementState, col: number, ridge: Band, passes: Set<number>) {
  return (
    col >= 0 &&
    !passes.has(col) &&
    ridge.get(col) >= minimumValleyDepth &&
    state.surface.channels.water.get(col) === 0 &&
    state.surface.channels.localRelief.get(col) >= mountainRelief &&
    !regionalBoundary(state, col)
  );
}

/** The upper summit body must span the existing physical footprint minimum. */
function resolvedSummit(state: RefinementState, cell: number, prominence: number) {
  const level = state.surface.channels.elevation.get(cell) - prominence * summitBodyShare,
    width = summitFlank(state, cell, 1, 0, level) + summitFlank(state, cell, -1, 0, level),
    length = summitFlank(state, cell, 0, 1, level) + summitFlank(state, cell, 0, -1, level);
  return width >= resolutionCells && length >= resolutionCells;
}

function summitFlank(state: RefinementState, cell: number, dx: number, dy: number, level: number) {
  const g = state.surface,
    h = g.channels.elevation,
    x = cell % g.width,
    y = Math.floor(cell / g.width);
  let steps = 0,
    previous = h.get(cell);
  for (let k = 1; ; k++) {
    const xx = x + k * dx,
      yy = y + k * dy;
    if (xx < 0 || xx >= g.width || yy < 0 || yy >= g.height) return steps;
    const height = h.get(yy * g.width + xx);
    if (height < level) return steps + (previous - level) / (previous - height);
    steps++;
    previous = height;
  }
}

/** One contour operation per class; disconnected pieces become separate geographic places. */
function publishReliefAreas(state: RefinementState, kind: "range" | "valley", membership: Band) {
  const g = state.surface,
    at = fieldInterpolator({ ...g, channels: { membership } }, "membership"),
    [dx, dy] = spacing(g),
    shape = fieldContour(
      g,
      (x, y) => at({ x, y, z: 0 }),
      regularContourSupport(g, (i) => membership.get(i) > 0),
      0.5,
      Math.min(dx, dy) / 4,
      state.contours
    );
  for (const [index, geometry] of polygons(shape).entries()) {
    const [w, s, e, n] = spatial.bounds(geometry);
    if (e - w < dx * resolutionCells || n - s < dy * resolutionCells) continue;
    const p = spatial.interiorPosition(geometry);
    putRefinementFeature(state, `${kind}:${index}`, kind, "geology", geometry, {
      area: spatial.area(geometry),
      representative: p,
      geometryMeaning: kind === "range" ? "connected mountain relief" : "opposing valley flanks",
    });
  }
}

function polygons(shape: Geometry | null) {
  if (shape?.type === "Polygon") return [shape];
  if (shape?.type === "MultiPolygon")
    return shape.coordinates.map((coordinates) => ({ type: "Polygon" as const, coordinates }));
  return [];
}

function extractWaterfalls(state: RefinementState) {
  const g = state.surface;
  if (!state.drainage) return;
  const drop = (i: number) => {
    const j = state.drainage!.receiver.get(i);
    return j < 0 ? 0 : g.channels.elevation.get(i) - g.channels.elevation.get(j);
  };
  regionalComponents(
    g,
    (i) => regionalKnickpoint(state, i),
    (members) => {
      const cell = members.reduce((a, b) => (drop(a) > drop(b) ? a : b));
      putRefinementFeature(
        state,
        `fall:${cell}`,
        "waterfall",
        "geology",
        point(gridPosition(g, cell)),
        {
          height: drop(cell),
          geometryMeaning: "channel knickpoint",
        }
      );
    }
  );
}

/** A fall is a sharp profile break, not an arbitrary cell on a continuously steep river. */
function regionalKnickpoint(state: RefinementState, i: number) {
  const g = state.surface,
    receiver = state.drainage!.receiver,
    j = receiver.get(i);
  if (g.channels.riverOrder.get(i) <= 0 || j < 0) return false;
  const slope = reachGradient(state, i),
    upstream = [...neighbors(g, i)].filter(
      (cell) => receiver.get(cell) === i && g.channels.riverOrder.get(cell) > 0
    );
  if (!upstream.length) return false;
  const above =
      upstream.reduce((sum, cell) => sum + reachGradient(state, cell), 0) / upstream.length,
    below = reachGradient(state, j),
    drop = g.channels.elevation.get(i) - g.channels.elevation.get(j),
    p = physicalProfile;
  return (
    drop >= p.WaterfallMinimumDrop &&
    slope >= p.WaterfallMinimumDrop / p.WaterfallEvaluationLength &&
    slope > knickpointContrast * Math.max(above, below)
  );
}

function reachGradient(state: RefinementState, i: number) {
  const j = state.drainage!.receiver.get(i),
    g = state.surface;
  return j < 0
    ? 0
    : Math.max(0, g.channels.elevation.get(i) - g.channels.elevation.get(j)) / distance(g, i, j);
}
