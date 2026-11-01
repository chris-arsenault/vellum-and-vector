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
import { Landform as L } from "../../canonry/codes";
import { physicalProfile } from "../../canonry/profile";
import { topographicProminence } from "../../topographicProminence";
import { generationFeature, writeGenerationFeature } from "../../generationFeatures";
import { putRegionalFeature } from "./features";
import {
  channel,
  clamp,
  distance,
  neighbors,
  onFrameEdge,
  regionalComponents,
  spacing,
  type RegionalState,
} from "../state";

/**
 * A summit is classed from this prominence; it is named only when it stands out at this
 * map's scale: a share of the parent sample span, so a regional map names the major peaks
 * and a finer map the lesser ones.
 */
const minimumProminence = 50;
const namedProminenceShare = 0.03;
/** Mountain country combines elevation and relief; a high flat plateau is not a range. */
const mountainRelief = 150;
const mountainElevation = 300;
/** A valley needs opposing flanks above its floor, not merely a blue channel. */
const minimumValleyDepth = 30;
/** The summit's upper body supplies its physical naming footprint. */
const summitBodyShare = 0.5;
/** A knickpoint must be markedly steeper than both adjacent reaches. */
const knickpointContrast = 3;

export function extractLandforms(state: RegionalState) {
  const g = state.surface,
    ridge = measureRelief(state),
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

/** Measure opposing flanks over resolved distances, using the present regional surface. */
function measureRelief(state: RegionalState) {
  const g = state.surface,
    at = fieldInterpolator(g, "elevation"),
    relief = channel(state, "localRelief", "metre"),
    valley = channel(state, "valleyDepth", "metre"),
    ridge = g.coverage.scratch("float64", "regional:ridge-height", g.active.length),
    [dx, dy] = spacing(g),
    radius = Math.max(dx * 2, dy * 2, state.parentSpan * 0.45),
    [w, s, e, n] = g.bounds;
  for (let i = 0; i < g.active.length; i++) {
    const p = gridPosition(g, i),
      own = g.channels.elevation.get(i),
      ring = Array.from({ length: 16 }, (_, k) => {
        const angle = (k * Math.PI) / 8;
        return at({
          x: clamp(p.x + Math.cos(angle) * radius, w, e),
          y: clamp(p.y + Math.sin(angle) * radius, s, n),
          z: 0,
        });
      });
    let depth = 0,
      rise = 0;
    for (let k = 0; k < 8; k++) {
      depth = Math.max(depth, Math.min(ring[k], ring[k + 8]) - own);
      rise = Math.max(rise, own - Math.max(ring[k], ring[k + 8]));
    }
    relief.set(i, Math.max(own, ...ring) - Math.min(own, ...ring));
    valley.set(i, depth);
    ridge.set(i, rise);
  }
  return ridge;
}

function classify(state: RegionalState, i: number, ridge: number) {
  const c = state.surface.channels;
  if (c.water.get(i) === 1) return L.Seabed;
  if (c.water.get(i) === 2) return L.Basin;
  if (c.valleyDepth.get(i) >= minimumValleyDepth) return L.Valley;
  if (ridge >= minimumValleyDepth) return L.Ridge;
  return c.slope.get(i) < 0.012 ? L.Plain : L.Slope;
}

/**
 * Summits by prominence and their joining cols. An inherited summit keeps its identity and
 * moves to the realized summit of its massif; new summits are named where they resolve.
 */
function extractSummits(state: RegionalState, ridge: Band) {
  const g = state.surface,
    { rise, saddle } = topographicProminence(
      g.coverage,
      g.channels.elevation,
      (i) => neighbors(g, i),
      g.channels.seaLevel?.get(0) ?? 0
    ),
    passes = new Set<number>(),
    named = Math.max(minimumProminence, namedProminenceShare * state.parentSpan),
    inherited = reanchorKnownSummits(state, rise);
  for (let i = 0; i < g.active.length; i++) {
    if (rise.get(i) < minimumProminence || onFrameEdge(g, i) || g.channels.water.get(i)) continue;
    g.channels.landform.set(i, L.Peak);
    if (rise.get(i) < named || !resolvedSummit(state, i, rise.get(i))) continue;
    if (!inherited.has(i))
      putRegionalFeature(state, `peak:${i}`, "peak", "geology", point(gridPosition(g, i)), {
        prominence: rise.get(i),
        elevation: g.channels.elevation.get(i),
        geometryMeaning: "prominent summit",
      });
    publishCol(state, saddle.get(i), ridge, passes);
  }
  g.coverage.release(rise);
  g.coverage.release(saddle);
}

function publishCol(state: RegionalState, col: number, ridge: Band, passes: Set<number>) {
  const g = state.surface;
  if (!usableCol(state, col, ridge, passes)) return;
  passes.add(col);
  g.channels.landform.set(col, L.Pass);
  putRegionalFeature(state, `pass:${col}`, "pass", "geology", point(gridPosition(g, col)), {
    elevation: g.channels.elevation.get(col),
    geometryMeaning: "joining col between summits",
  });
}

/** An inherited peak feature moves to the most prominent realized summit within its reach. */
function reanchorKnownSummits(state: RegionalState, rise: Band) {
  const g = state.surface,
    taken = new Set<number>();
  for (const peak of state.evidence?.summits ?? []) {
    const feature = generationFeature(state, peak.featureId);
    if (!feature) continue;
    const best = mostProminentNear(state, rise, peak.cell, taken);
    if (best < 0) continue;
    taken.add(best);
    peak.cell = best;
    const from = (feature.geometry as GeoJSON.Point).coordinates;
    feature.geometry = point(gridPosition(g, best));
    feature.attributes = {
      ...feature.attributes,
      anchoredFrom: feature.attributes.anchoredFrom ?? [from[0], from[1]],
      capturedProminence: feature.attributes.capturedProminence ?? feature.attributes.prominence,
      prominence: rise.get(best),
      elevation: g.channels.elevation.get(best),
    };
    writeGenerationFeature(state, feature);
  }
  return taken;
}

/** The most prominent free summit cell within a parent span of a captured position, or -1. */
function mostProminentNear(state: RegionalState, rise: Band, cell: number, taken: Set<number>) {
  const g = state.surface,
    [dx, dy] = spacing(g),
    reach = state.parentSpan,
    rx = Math.ceil(reach / dx),
    ry = Math.ceil(reach / dy),
    cx = cell % g.width,
    cy = Math.floor(cell / g.width),
    excluded = (i: number) =>
      taken.has(i) ||
      Boolean(g.channels.water.get(i)) ||
      onFrameEdge(g, i) ||
      distance(g, cell, i) > reach;
  let best = -1,
    bestRise = 0;
  for (let y = Math.max(0, cy - ry); y <= Math.min(g.height - 1, cy + ry); y++)
    for (let x = Math.max(0, cx - rx); x <= Math.min(g.width - 1, cx + rx); x++) {
      const i = y * g.width + x;
      if (excluded(i) || rise.get(i) <= bestRise) continue;
      bestRise = rise.get(i);
      best = i;
    }
  return best;
}

function usableCol(state: RegionalState, col: number, ridge: Band, passes: Set<number>) {
  return (
    col >= 0 &&
    !passes.has(col) &&
    ridge.get(col) >= minimumValleyDepth &&
    state.surface.channels.water.get(col) === 0 &&
    state.surface.channels.localRelief.get(col) >= mountainRelief &&
    !onFrameEdge(state.surface, col)
  );
}

/** The upper summit body must span the existing physical footprint minimum. */
function resolvedSummit(state: RegionalState, cell: number, prominence: number) {
  const level = state.surface.channels.elevation.get(cell) - prominence * summitBodyShare,
    width = summitFlank(state, cell, 1, 0, level) + summitFlank(state, cell, -1, 0, level),
    length = summitFlank(state, cell, 0, 1, level) + summitFlank(state, cell, 0, -1, level);
  return width >= resolutionCells && length >= resolutionCells;
}

function summitFlank(state: RegionalState, cell: number, dx: number, dy: number, level: number) {
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
function publishReliefAreas(state: RegionalState, kind: "range" | "valley", membership: Band) {
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
    putRegionalFeature(state, `${kind}:${index}`, kind, "geology", geometry, {
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

function extractWaterfalls(state: RegionalState) {
  const g = state.surface;
  if (!state.drainage) return;
  const drop = (i: number) => {
    const j = state.drainage!.receiver.get(i);
    return j < 0 ? 0 : g.channels.elevation.get(i) - g.channels.elevation.get(j);
  };
  regionalComponents(
    g,
    (i) => knickpoint(state, i),
    (members) => {
      const cell = members.reduce((a, b) => (drop(a) > drop(b) ? a : b));
      putRegionalFeature(
        state,
        `fall:${cell}`,
        "waterfall",
        "geology",
        point(gridPosition(g, cell)),
        { height: drop(cell), geometryMeaning: "channel knickpoint" }
      );
    }
  );
}

/** A fall is a sharp profile break, not an arbitrary cell on a continuously steep river. */
function knickpoint(state: RegionalState, i: number) {
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

function reachGradient(state: RegionalState, i: number) {
  const j = state.drainage!.receiver.get(i),
    g = state.surface;
  return j < 0
    ? 0
    : Math.max(0, g.channels.elevation.get(i) - g.channels.elevation.get(j)) / distance(g, i, j);
}
