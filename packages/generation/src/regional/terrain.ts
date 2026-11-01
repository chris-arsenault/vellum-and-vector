import { fieldInterpolator, gridPosition } from "@atlas/domain";
import { fractalNoise, hashUnit } from "../canonry/noise";
import { generationFeatures } from "../generationFeatures";
import { grainAt } from "./character";
import { courseIndex } from "./courses";
import {
  emptyRoutes,
  evolveLandscape,
  floodRoutes,
  gaussianBlur,
  glacialReworking,
  gridNeighbors,
  protectBasins,
  type LandscapeRoutes,
} from "./landscape";
import {
  cellAt,
  channel,
  clamp,
  onFrameEdge,
  regionalComponents,
  resolvesRegionalComponent,
  spacing,
  type RegionalState,
  type TerrainWork,
} from "./state";

/** Horizontal displacement varies coastlines and divides without serrating every height. */
const displacementShare = 0.18;
/** Smoothing radius, as a share of the parent sample span, removing the parent's patch creases. */
const baseSmoothing = 0.35;
/** Sea floor below this depth keeps its sampled value; shallower water is smoothed with the shore. */
const shelfDepth = 30;
/** Minimum rolling relief, as a slope over one parent sample, that plains develop. */
const rollingSlope = 0.004;
/** Share of the captured height above the datum that strained country raises into relief. */
const heightShare = 0.05,
  strainedHeightShare = 0.4;
/** Share of the captured local relief (over one parent span) added to the intent. */
const reliefShare = 0.5;
/** Runoff, in metres per year, that one reference cell of discharge represents. */
export const referenceRunoff = 0.4;
/** Share of reference runoff that occasional floods supply to valley cutting on dry ground. */
const floodRunoff = 0.3;
/** Depth distinguishing a newly formed basin (for example a magical hollow) from surface roughness. */
const newBasinDepth = 20;
/** Share of an inherited summit's prominence its surroundings rise by. */
const summitShare = 0.5;
/** The most an inherited summit raises its surroundings (m): it organizes a massif, not a cone. */
const summitRiseLimit = 500;
/** Along-grain organization wavelength, as a share of the parent span; summits separate at it. */
const organizationWavelength = 1.2;
/** Across-grain material band spacing, as a share of the parent span. */
const bandWavelength = 1;
/** Amplitude of the organized relief modulation and of the across-grain bands. */
const organizationAmplitude = 1.8,
  bandAmplitude = 0.2;
/** Erodibility contrast between weak and resistant bands, as an exponent at full coherence. */
const bandContrast = 0.6;
/**
 * Fine heterogeneity of the substrate (joints, lenses, weathering), as an exponent: without
 * it a smooth flank drains in parallel consequent lines instead of a dendritic network.
 */
const substrateRoughness = 0.9;
/** Share of the uplift intent that seeds the starting surface, breaking a planar flank's ties. */
const seedShare = 0.3;
/** Cirque excavation depth at full reworking: a share of the parent span, at least this. */
const cirqueDepthShare = 0.01,
  cirqueDepthMinimum = 45;

/** The three rounds' numerical budgets: broad organization first, local consequences last. */
export const terrainRounds = [
  { steps: 20, uplift: 0.5, diffusion: 0.08 },
  { steps: 16, uplift: 0.35, diffusion: 0.06 },
  { steps: 12, uplift: 0.15, diffusion: 0.05 },
];
const anchorStrength = 0.5,
  anchorEvery = 4;

/** Channels every run carries, physical or not. */
export function ensureTerrainChannels(state: RegionalState) {
  channel(state, "fracture", "ratio");
  channel(state, "rock", "ratio", 1);
  channel(state, "sediment", "metre");
  channel(state, "erosion", "metre");
}

/**
 * Working structures the rounds evolve, derived once from the captured context: the smoothed
 * base, the connected sea, river inlets, captured basins, the uplift intent and the material
 * organization. The surface starts at the base with a small symmetry-breaking seed.
 */
/**
 * A closed depression the parent itself holds (a desert basin, a dry pan) is a captured
 * fact: it keeps its bowl, and whether it holds water follows its supply. Filling it flat
 * would invent a plain whose drainage runs in straight lines.
 */
function capturedDepressions(
  state: RegionalState,
  base: Float64Array,
  sea: Uint8Array,
  inlet: Uint8Array,
  basin: Uint8Array
) {
  const g = state.surface,
    [dx, dy] = spacing(g),
    routes = emptyRoutes(base.length);
  floodRoutes({ width: g.width, height: g.height, dx, dy }, base, sea, inlet, routes);
  const depth = new Float64Array(base.length);
  for (let i = 0; i < base.length; i++) depth[i] = sea[i] ? 0 : routes.filled[i] - base[i];
  regionalComponents(
    g,
    (i) => depth[i] > 1e-3,
    (members) => {
      let deepest = 0;
      for (const i of members) deepest = Math.max(deepest, depth[i]);
      if (deepest >= newBasinDepth && resolvesRegionalComponent(g, members))
        for (const i of members) basin[i] = 1;
    }
  );
}

export function prepareTerrain(state: RegionalState): TerrainWork {
  ensureTerrainChannels(state);
  const g = state.surface,
    c = g.channels,
    n = g.active.length,
    datum = c.seaLevel?.get(0) ?? 0,
    base = smoothedBase(state, datum),
    sea = connectedSea(state, base, datum),
    { inlet, inflow } = riverInlets(state, sea),
    basin = new Uint8Array(n);
  for (let i = 0; i < n; i++) basin[i] = Number(!sea[i] && c.water?.get(i) === 2);
  capturedDepressions(state, base, sea, inlet, basin);
  const terrain: TerrainWork = {
    base,
    sea,
    inlet,
    inflow,
    basin,
    uplift: new Float64Array(n),
    banding: new Float64Array(n),
    peaks: knownPeaks(state),
  };
  state.terrain = terrain;
  organize(state, terrain);
  const captured = g.coverage.scratch("uint8", "regional:captured-basins", n),
    entering = g.coverage.scratch("float64", "regional:river-inflow", n),
    reference = referenceDischarge(state),
    [dx, dy] = spacing(g);
  for (let i = 0; i < n; i++) {
    captured.set(i, basin[i]);
    entering.set(i, inflow[i] * reference);
    const p = gridPosition(g, i),
      seed = fractalNoise(p.x, p.y, state.input.seed ^ 0x77, Math.max(dx, dy) * 4, 2);
    c.elevation.set(
      i,
      sea[i] ? Math.min(base[i], datum - 1) : base[i] + seed * terrain.uplift[i] * seedShare
    );
  }
  state.captured = { basin: captured, inflow: entering };
  updateSlopes(state);
  return terrain;
}

/**
 * The uplift intent and the material organization. Relief intent follows the captured local
 * relief and tectonic strain; it is organized along the structural grain (elongated highs,
 * separate summits), raised around inherited summits and volcanic cones, and lowered along
 * captured river courses. Erodibility bands across the grain let strike valleys and ridges
 * develop; courses and ice-carved ground erode more readily.
 */
function organize(state: RegionalState, terrain: TerrainWork) {
  const g = state.surface,
    n = g.active.length,
    [dx, dy] = spacing(g),
    cell = Math.min(dx, dy),
    datum = g.channels.seaLevel?.get(0) ?? 0,
    character = state.character!,
    course = courseWeight(state, courseIndex(state, state.courses ?? [])),
    relief = localRelief(state, terrain.base),
    wavelength = Math.max(state.parentSpan * organizationWavelength, cell * 6),
    bands = Math.max(state.parentSpan * bandWavelength, cell * 4),
    seed = state.input.seed;
  for (let i = 0; i < n; i++) {
    if (terrain.sea[i]) continue;
    const p = gridPosition(g, i),
      { theta, coherence } = grainAt(character, i),
      ux = Math.cos(theta),
      uy = Math.sin(theta),
      along = p.x * ux + p.y * uy,
      across = -p.x * uy + p.y * ux,
      organized = fractalNoise(along, across * 0.25, seed ^ 0x5e1f, wavelength, 3),
      isotropic = fractalNoise(p.x, p.y, seed ^ 0x3a27, wavelength, 3),
      // Bands across the grain: the belt's folds and strata, of varying spacing, pinching
      // out along the strike. Resistant bands rise and resist; weak bands erode into
      // strike valleys.
      band = fractalNoise(across, along * 0.25, seed ^ 0x1c3d, bands, 2) * 1.6,
      modulation =
        (1 + organizationAmplitude * (coherence * organized + (1 - coherence) * isotropic)) *
        (1 + bandAmplitude * coherence * band),
      // Mountain country is the captured height of strained ground: the higher and the
      // more strained, the more relief its massifs develop above and below the captured mean.
      mass =
        Math.max(0, terrain.base[i] - datum) *
        (heightShare + strainedHeightShare * character.strain[i]),
      intent = mass + reliefShare * relief[i] + rollingSlope * state.parentSpan;
    // A captured river's course is low ground that erodes readily: the developed drainage
    // gathers to it rather than cutting a parallel valley beside it.
    terrain.uplift[i] = intent * modulation * (1 - 0.5 * course[i]);
    const grain = fractalNoise(p.x, p.y, seed ^ 0x4d2f, cell * 5, 3);
    terrain.banding[i] =
      Math.exp(-bandContrast * coherence * band + substrateRoughness * grain) *
      (1 + course[i]) *
      (1 + character.reworking[i]);
  }
  for (const peak of terrain.peaks)
    raiseAround(
      state,
      terrain,
      peak.cell,
      state.parentSpan * 2,
      (d) =>
        Math.min(summitRiseLimit, summitShare * peak.prominence) *
        Math.exp(-((d / (state.parentSpan * 0.5)) ** 2))
    );
  for (const cone of character.cones)
    raiseAround(
      state,
      terrain,
      cone.cell,
      cone.radius,
      (d) => cone.height * Math.max(0, 1 - d / cone.radius)
    );
}

function raiseAround(
  state: RegionalState,
  terrain: TerrainWork,
  center: number,
  reach: number,
  amount: (distance: number) => number
) {
  const g = state.surface,
    [dx, dy] = spacing(g),
    cx = center % g.width,
    cy = Math.floor(center / g.width),
    rx = Math.ceil(reach / dx),
    ry = Math.ceil(reach / dy);
  for (let y = Math.max(0, cy - ry); y <= Math.min(g.height - 1, cy + ry); y++)
    for (let x = Math.max(0, cx - rx); x <= Math.min(g.width - 1, cx + rx); x++) {
      const i = y * g.width + x;
      if (terrain.sea[i]) continue;
      const d = Math.hypot((x - cx) * dx, (y - cy) * dy);
      if (d <= reach) terrain.uplift[i] += amount(d);
    }
}

/** 1 on a captured course, 0.5 beside it, 0 elsewhere. */
function courseWeight(state: RegionalState, owner: Int32Array) {
  // A captured course is a broad valley at the parent's scale, not a one-cell trench: its
  // influence falls off over a share of the parent span, and the developed stream wanders
  // within that valley.
  const g = state.surface,
    n = owner.length,
    [dx, dy] = spacing(g),
    reach = Math.max(2, Math.round((state.parentSpan * 0.3) / Math.min(dx, dy))),
    steps = new Int32Array(n).fill(-1),
    queue = new Int32Array(n),
    weight = new Float64Array(n),
    around = new Int32Array(8);
  let write = 0;
  for (let i = 0; i < n; i++)
    if (owner[i] >= 0) {
      steps[i] = 0;
      queue[write++] = i;
    }
  for (let read = 0; read < write; read++) {
    const i = queue[read],
      d = steps[i] / reach;
    weight[i] = Math.exp(-2 * d * d);
    if (steps[i] >= reach) continue;
    const m = gridNeighbors(g.width, g.height, i, around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (steps[j] < 0) {
        steps[j] = steps[i] + 1;
        queue[write++] = j;
      }
    }
  }
  return weight;
}

/** Inherited significant summits on this map, as evidence for where relief concentrates. */
function knownPeaks(state: RegionalState): TerrainWork["peaks"] {
  const peaks: TerrainWork["peaks"] = [];
  for (const f of generationFeatures(state, { areaId: state.input.areaId })) {
    if (f.kind !== "peak" || f.geometry.type !== "Point") continue;
    // A summit an earlier refinement re-anchored is read from its captured position.
    const captured = f.attributes.anchoredFrom as [number, number] | undefined,
      [x, y] = captured ?? f.geometry.coordinates,
      cell = cellAt(state, x, y);
    if (state.surface.channels.water?.get(cell) === 1) continue;
    peaks.push({
      featureId: f.id,
      cell,
      prominence: Number(f.attributes.capturedProminence ?? f.attributes.prominence ?? 300),
    });
  }
  return peaks;
}

/**
 * One round of landscape evolution on the shared media: erodibility reads the present rock,
 * fractures and living cover, runoff the present supply. The round's share of the uplift
 * intent is applied; nothing is reset to the captured surface.
 */
export function developTerrain(state: RegionalState, round: number) {
  const terrain = state.terrain!,
    budget = terrainRounds[Math.min(terrainRounds.length, Math.max(1, round)) - 1],
    g = state.surface,
    c = g.channels,
    n = g.active.length,
    [dx, dy] = spacing(g),
    datum = c.seaLevel?.get(0) ?? 0,
    height = new Float64Array(n),
    uplift = new Float64Array(n),
    runoff = new Float64Array(n),
    erodibility = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    height[i] = c.elevation.get(i);
    uplift[i] = terrain.uplift[i] * budget.uplift;
    runoff[i] = Math.max(floodRunoff, (c.runoff?.get(i) ?? referenceRunoff) / referenceRunoff);
    const material = (1 + 0.5 * clamp(c.fracture.get(i))) / clamp(c.rock.get(i) || 1, 0.5, 2),
      cover = Math.max(
        0.4,
        1 - 0.35 * clamp(c.treeCover?.get(i) ?? 0) - 0.2 * clamp(c.wetlandCover?.get(i) ?? 0)
      );
    erodibility[i] = clamp(terrain.banding[i] * material * cover, 0.2, 4);
  }
  const { deposit } = evolveLandscape(
    { width: g.width, height: g.height, dx, dy },
    {
      height,
      uplift,
      base: terrain.base,
      sea: terrain.sea,
      inlet: terrain.inlet,
      inflow: terrain.inflow,
      runoff,
      erodibility,
      basin: terrain.basin,
      reworking: state.character!.reworking,
    },
    {
      steps: budget.steps,
      diffusion: budget.diffusion,
      anchorSigma: [state.parentSpan / dx, state.parentSpan / dy],
      anchorStrength,
      anchorEvery,
    }
  );
  if (round === 1) carveCirques(state, height);
  for (let i = 0; i < n; i++) {
    const h = terrain.sea[i] ? Math.min(height[i], datum - 1) : Math.max(height[i], datum + 1);
    c.elevation.set(i, h);
    c.erosion.set(i, Math.max(0, terrain.base[i] - h));
    c.sediment.add(i, deposit[i]);
  }
  updateSlopes(state);
}

/**
 * Ice-carved headwaters. Where reworking is thorough, the high ground at the heads of the
 * developed drainage is excavated into bowls; the solver then keeps them as basins, and
 * whether each holds a tarn depends on its water supply.
 */
function carveCirques(state: RegionalState, height: Float64Array) {
  const { reworking } = state.character!,
    terrain = state.terrain!,
    g = state.surface,
    n = g.active.length,
    [dx, dy] = spacing(g),
    grid = { width: g.width, height: g.height, dx, dy },
    routes = emptyRoutes(n);
  if (!reworking.some((value) => value >= glacialReworking)) return;
  floodRoutes(grid, height, terrain.sea, terrain.inlet, routes);
  const upstream = new Int32Array(n);
  for (let k = routes.count - 1; k >= 0; k--) {
    const i = routes.order[k],
      j = routes.receiver[i];
    if (j >= 0) upstream[j] += upstream[i] + 1;
  }
  const window = Math.max(2, Math.round((state.parentSpan * 0.7) / Math.min(dx, dy))),
    around = new Int32Array(8),
    score = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (terrain.sea[i] || reworking[i] < glacialReworking || upstream[i] > 6) continue;
    const x = i % g.width,
      y = Math.floor(i / g.width);
    // A bowl needs its rim inside the frame; an edge cell drains out and cannot hold one.
    if (x < 2 || y < 2 || x > g.width - 3 || y > g.height - 3) continue;
    score[i] = reworking[i] * height[i] * (0.7 + 0.6 * hashUnit(state.input.seed ^ 0xc1c, x, y));
  }
  for (let i = 0; i < n; i++) {
    if (score[i] <= 0) continue;
    const x = i % g.width,
      y = Math.floor(i / g.width);
    let best = true;
    for (let oy = -window; oy <= window && best; oy++)
      for (let ox = -window; ox <= window; ox++) {
        const xx = x + ox,
          yy = y + oy;
        if (xx < 0 || yy < 0 || xx >= g.width || yy >= g.height) continue;
        const j = yy * g.width + xx;
        if (score[j] > score[i] || (score[j] === score[i] && j < i)) {
          best = false;
          break;
        }
      }
    if (!best) continue;
    // The bowl closes below the lowest cell of its outer ring, its lip, however steep the
    // flank it is cut into; the floor is deepest at the centre.
    const depth = Math.max(cirqueDepthMinimum, cirqueDepthShare * state.parentSpan) * reworking[i];
    let lip = Infinity;
    for (let oy = -2; oy <= 2; oy++)
      for (let ox = -2; ox <= 2; ox++) {
        if (Math.abs(ox) < 2 && Math.abs(oy) < 2) continue;
        const xx = x + ox,
          yy = y + oy;
        if (xx < 0 || yy < 0 || xx >= g.width || yy >= g.height) continue;
        lip = Math.min(lip, height[yy * g.width + xx]);
      }
    height[i] = Math.min(height[i], lip - depth * 0.6);
    const m = gridNeighbors(g.width, g.height, i, around);
    for (let k = 0; k < m; k++)
      if (!terrain.sea[around[k]])
        height[around[k]] = Math.min(height[around[k]], lip - depth * 0.3);
    state.cirques = (state.cirques ?? 0) + 1;
  }
}

/** Sample the parent surface with a gentle displacement, then smooth its interpolation creases. */
function smoothedBase(state: RegionalState, datum: number) {
  const g = state.surface,
    n = g.active.length,
    [dx, dy] = spacing(g),
    at = inheritedSampler(state),
    wavelength = Math.max(state.parentSpan, Math.max(dx, dy) * 4),
    sampled = new Float64Array(n),
    clamped = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = gridPosition(g, i),
      warpX = fractalNoise(p.x, p.y, state.input.seed ^ 0x51a3, wavelength * 2, 2),
      warpY = fractalNoise(p.x, p.y, state.input.seed ^ 0x7c4b, wavelength * 2, 2);
    sampled[i] = at(
      p.x + warpX * wavelength * displacementShare,
      p.y + warpY * wavelength * displacementShare
    );
    clamped[i] = Math.max(sampled[i], datum - shelfDepth);
  }
  const sigma = state.parentSpan * baseSmoothing;
  gaussianBlur(clamped, g.width, g.height, sigma / dx, sigma / dy);
  // The sea floor is smoothed on its own so deep water keeps its depth without the
  // parent's patch creases, and never pulls the shore down with it.
  gaussianBlur(sampled, g.width, g.height, sigma / dx, sigma / dy);
  for (let i = 0; i < n; i++) if (clamped[i] < datum) clamped[i] = Math.min(clamped[i], sampled[i]);
  return clamped;
}

export function inheritedSampler(state: RegionalState) {
  const g = state.surface,
    at = fieldInterpolator({ ...g, channels: { elevation: state.inheritedHeight } }, "elevation"),
    [w, s, e, n] = g.bounds;
  return (x: number, y: number) => at({ x: clamp(x, w, e), y: clamp(y, s, n), z: 0 });
}

/** Height range across one parent sample span, which scales the new sub-parent relief. */
function localRelief(state: RegionalState, base: Float64Array) {
  const g = state.surface,
    [dx, dy] = spacing(g),
    rx = Math.max(1, Math.round(state.parentSpan / dx)),
    ry = Math.max(1, Math.round(state.parentSpan / dy)),
    relief = new Float64Array(base.length);
  for (let i = 0; i < base.length; i++) {
    const x = i % g.width,
      y = Math.floor(i / g.width);
    let low = base[i],
      high = base[i];
    for (let k = 0; k < 8; k++) {
      const angle = (k * Math.PI) / 4,
        xx = clamp(Math.round(x + Math.cos(angle) * rx), 0, g.width - 1),
        yy = clamp(Math.round(y + Math.sin(angle) * ry), 0, g.height - 1),
        h = base[yy * g.width + xx];
      low = Math.min(low, h);
      high = Math.max(high, h);
    }
    relief[i] = high - low;
  }
  return relief;
}

/** Water below the datum joined to the captured ocean or an open frame edge. */
function connectedSea(state: RegionalState, height: Float64Array, datum: number) {
  const g = state.surface,
    n = height.length,
    sea = new Uint8Array(n),
    queue = new Int32Array(n),
    around = new Int32Array(8);
  let write = 0;
  for (let i = 0; i < n; i++)
    if (height[i] <= datum && (onFrameEdge(g, i) || g.channels.water?.get(i) === 1)) {
      sea[i] = 1;
      queue[write++] = i;
    }
  for (let read = 0; read < write; read++) {
    const m = gridNeighbors(g.width, g.height, queue[read], around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (sea[j] || height[j] > datum) continue;
      sea[j] = 1;
      queue[write++] = j;
    }
  }
  return sea;
}

/**
 * A captured river crossing the frame edge brings its upstream discharge with it.
 * Each crossing enters at the edge sample carrying the most captured flow.
 */
function riverInlets(state: RegionalState, sea: Uint8Array) {
  const g = state.surface,
    c = g.channels,
    n = g.active.length,
    inlet = new Uint8Array(n),
    inflow = new Float64Array(n),
    reference = referenceDischarge(state);
  if (!c.riverOrder || !c.flow) return { inlet, inflow };
  const edge = edgeRing(g.width, g.height),
    flow = (i: number) => (!sea[i] && c.riverOrder.get(i) > 0 ? c.flow.get(i) : 0);
  for (let k = 0; k < edge.length; k++) {
    const i = edge[k],
      before = flow(edge[(k - 1 + edge.length) % edge.length]),
      after = flow(edge[(k + 1) % edge.length]);
    if (flow(i) <= 0 || before > flow(i) || after >= flow(i) || !flowsInward(state, i)) continue;
    inlet[i] = 1;
    inflow[i] = flow(i) / reference;
  }
  return { inlet, inflow };
}

/** Frame edge samples in order around the rectangle. */
function edgeRing(width: number, height: number) {
  const edge: number[] = [];
  for (let x = 0; x < width; x++) edge.push(x);
  for (let y = 1; y < height; y++) edge.push(y * width + width - 1);
  for (let x = width - 2; x >= 0; x--) edge.push((height - 1) * width + x);
  for (let y = height - 2; y > 0; y--) edge.push(y * width);
  return edge;
}
const secondsPerYear = 365.25 * 24 * 3600;
/** Discharge of one interior sample at reference runoff, in m³/s. */
export function referenceDischarge(state: RegionalState) {
  const [dx, dy] = spacing(state.surface);
  return (referenceRunoff * dx * dy) / secondsPerYear;
}

/** The captured surface descends from the edge sample into the frame. */
function flowsInward(state: RegionalState, i: number) {
  const g = state.surface,
    h = state.inheritedHeight,
    x = i % g.width,
    y = Math.floor(i / g.width),
    inner =
      clamp(y + (y === 0 ? 2 : y === g.height - 1 ? -2 : 0), 0, g.height - 1) * g.width +
      clamp(x + (x === 0 ? 2 : x === g.width - 1 ? -2 : 0), 0, g.width - 1);
  return h.get(inner) < h.get(i);
}

/**
 * Fill closed depressions after a later change to the surface. Captured lake basins,
 * ice-carved hollows and substantial new basins (a magical hollow) remain; pits drain.
 */
export function fillRegionalPits(state: RegionalState) {
  const g = state.surface,
    n = g.active.length,
    [dx, dy] = spacing(g),
    { height, sea } = presentSurface(state),
    routes = emptyRoutes(n);
  floodRoutes({ width: g.width, height: g.height, dx, dy }, height, sea, new Uint8Array(n), routes);
  const kept = retainedBasins(state, height, sea, routes);
  for (let i = 0; i < n; i++) {
    if (sea[i] || kept[i] || routes.filled[i] <= height[i]) continue;
    const deposit = routes.filled[i] - height[i];
    g.channels.elevation.set(i, routes.filled[i]);
    g.channels.sediment?.add(i, deposit);
  }
}
function presentSurface(state: RegionalState) {
  const c = state.surface.channels,
    n = state.surface.active.length,
    height = new Float64Array(n),
    sea = new Uint8Array(n),
    datum = c.seaLevel?.get(0) ?? 0;
  for (let i = 0; i < n; i++) {
    height[i] = c.elevation.get(i);
    sea[i] = Number(c.water?.get(i) === 1 && height[i] <= datum);
  }
  return { height, sea };
}

function retainedBasins(
  state: RegionalState,
  height: Float64Array,
  sea: Uint8Array,
  routes: LandscapeRoutes
) {
  const g = state.surface,
    n = height.length,
    [dx, dy] = spacing(g),
    kept = new Uint8Array(n),
    captured = new Uint8Array(n),
    reworking = state.character?.reworking ?? new Float64Array(n);
  for (let i = 0; i < n; i++) captured[i] = state.captured?.basin.get(i) ?? 0;
  protectBasins(
    { width: g.width, height: g.height, dx, dy },
    height,
    routes.filled,
    { basin: captured, reworking },
    kept
  );
  regionalComponents(
    g,
    (i) => !sea[i] && !kept[i] && routes.filled[i] - height[i] > 1e-3,
    (members) => {
      let depth = 0;
      for (const i of members) depth = Math.max(depth, routes.filled[i] - height[i]);
      if (depth >= newBasinDepth && resolvesRegionalComponent(g, members))
        for (const i of members) kept[i] = 1;
    }
  );
  return kept;
}

export function gradient(state: RegionalState, i: number, inherited = false) {
  const g = state.surface,
    h = inherited ? state.inheritedHeight : g.channels.elevation,
    [dx, dy] = spacing(g),
    x = i % g.width,
    y = Math.floor(i / g.width),
    left = x > 0 ? i - 1 : i,
    right = x + 1 < g.width ? i + 1 : i,
    below = y > 0 ? i - g.width : i,
    above = y + 1 < g.height ? i + g.width : i;
  return {
    gx: (h.get(right) - h.get(left)) / ((right - left) * dx || dx),
    gy: (h.get(above) - h.get(below)) / (((above - below) / g.width) * dy || dy),
  };
}
export function updateSlopes(state: RegionalState) {
  const slope = channel(state, "slope", "ratio");
  for (let i = 0; i < slope.length; i++) {
    const { gx, gy } = gradient(state, i);
    slope.set(i, Math.hypot(gx, gy));
  }
}
