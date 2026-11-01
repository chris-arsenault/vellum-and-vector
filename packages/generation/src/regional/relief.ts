import { materialBands, materialResistance } from "./material";
import { applyGlaciation } from "./glacial";
import { channelCells, referenceDischarge } from "./network";
import {
  channel,
  clamp,
  gaussianBlur,
  gridNeighbors,
  spacing,
  type Evidence,
  type NetworkWork,
  type ReliefWork,
  type RegionalState,
} from "./state";

/** Channel gradient at the channel threshold area, and the concavity of the longitudinal profile. */
const headwaterGradient = 0.04,
  concavity = 0.45;
/** Hillslope gradient of unweathered ground; glacial reworking and cover soften it. */
const hillslopeGradient = 0.3,
  reworkedSoftening = 0.6,
  coverSoftening = 0.2;
/** Captured lake depth where the parent published none. */
const defaultLakeDepth = 6;
/** Calibration passes fitting the parent-span blur of the relief to the captured base. */
const calibrationPasses = 3;
/** Amplification bounds and the smallest macro relief treated as a plain. */
const minimumAmplification = 0.08,
  maximumAmplification = 8,
  plainRelief = 2;
/** The least a cell rises above its receiver, keeping the derived surface drainable. */
const monotoneRise = 0.05;
/** Sideways coupling of hillslopes and the passes it is applied in. */
const hillslopeCoupling = 0.5,
  hillslopePasses = 3;
/** Gradient of the captured base above which its step is climbed in place as a knickpoint. */
const knickpointGradient = 0.025;
/** Hillslope steps from the channel over which the slope flattens toward its divide, and the floor it keeps. */
const convexityLength = 20,
  divideFloor = 0.25;

/** Channels every run carries, physical or not. */
export function ensureSurfaceChannels(state: RegionalState) {
  channel(state, "fracture", "ratio");
  channel(state, "rock", "ratio", 1);
  channel(state, "sediment", "metre");
  channel(state, "erosion", "metre");
  channel(state, "ice", "ratio");
}

/** Per-cell rise above the receiver: the amplified process part and the unamplified base step. */
interface Increments {
  increment: Float64Array;
  step: Float64Array;
}

/**
 * Derive the relief from the network and the present media (spec 6.1). Every cell rises
 * above its receiver: along a channel by the concave profile of its discharge through its
 * material, on a hillslope by the material's gradient flattening toward the divide, both
 * held down inside a seat's footprint. The increments are amplified so that the relief
 * blurred to the parent span is the captured base: the parent sets the macro character, the
 * network decides where within it the summits, cols, valleys and low ground lie. Ice then
 * carves the surface the climate allows, and cones add their construction. Re-deriving in a
 * later round reads the media as they are then from the same network, so a change updates
 * the relief rather than adding to it.
 */
export function deriveRelief(state: RegionalState) {
  const g = state.surface,
    n = g.active.length,
    network = state.network!,
    datum = g.channels.seaLevel?.get(0) ?? 0,
    evidence = state.evidence!,
    increments = reliefIncrements(state),
    amplification = calibrate(state, increments, datum),
    h = new Float64Array(n),
    basin = new Uint8Array(n);
  construct(network, increments, amplification, h, datum, evidence);
  smoothHillslopes(state, h);
  buildCones(state, h);
  for (let i = 0; i < n; i++) if (network.lake[i] >= 0 || network.sink[i]) basin[i] = 1;
  const relief: ReliefWork = { amplification, basin, iceFlux: new Float64Array(n) };
  applyGlaciation(state, h, relief);
  keepDrainable(network, h, basin);
  writeSurface(state, h, datum);
  state.relief = relief;
  updateSlopes(state);
}

/** The rise each cell asks above its receiver, from the network and the present media. */
function reliefIncrements(state: RegionalState): Increments {
  const g = state.surface,
    n = g.active.length,
    c = g.channels,
    network = state.network!,
    { receiver, order, count, base } = network,
    [dx, dy] = spacing(g),
    bands = materialBands(state),
    thresholdArea = channelCells * dx * dy,
    cap = seatCaps(state),
    increment = new Float64Array(n),
    step = new Float64Array(n),
    steps = new Int32Array(n),
    reworking = state.character?.reworking;
  for (let k = 0; k < count; k++) {
    const j = order[k],
      i = receiver[j];
    if (i < 0) continue;
    const length = Math.hypot(
        ((j % g.width) - (i % g.width)) * dx,
        (Math.floor(j / g.width) - Math.floor(i / g.width)) * dy
      ),
      material = materialResistance(state, bands, j);
    let gradient: number;
    if (network.channel[j]) {
      const area = Math.max(thresholdArea, network.area[j]);
      gradient = headwaterGradient * Math.sqrt(material) * (area / thresholdArea) ** -concavity;
    } else {
      // A creep-shaped hillslope is steepest above the channel and flattens toward its
      // divide; where channels are sparse (dry or resistant country) the long slopes end
      // in broad flat tops, where they are dense the divides stay sharp.
      steps[j] = steps[i] + 1;
      const reworked = 1 - reworkedSoftening * (reworking?.[j] ?? 0),
        cover = 1 - coverSoftening * clamp(c.treeCover?.get(j) ?? 0),
        convexity = Math.max(divideFloor, 1 - steps[j] / convexityLength);
      gradient = hillslopeGradient * material * reworked * cover * convexity;
    }
    if (cap[j] > 0) gradient = Math.min(gradient, cap[j]);
    increment[j] = length * gradient;
    // A step of the captured base steeper than any profile (an escarpment, a plateau edge)
    // is macro character the path must climb where it stands: a knickpoint, not a fall
    // spread along the whole profile. It is not amplified.
    step[j] = Math.max(0, base[j] - base[i] - knickpointGradient * length);
  }
  return { increment, step };
}

/** Fit the amplification so the parent-span blur of the relief is the captured base. */
function calibrate(state: RegionalState, increments: Increments, datum: number) {
  const g = state.surface,
    n = g.active.length,
    network = state.network!,
    { sea, base, level } = network,
    [dx, dy] = spacing(g),
    sigma = state.parentSpan,
    amplification = new Float64Array(n).fill(1),
    blurredBase = new Float64Array(base),
    blurredLevel = new Float64Array(level),
    blurred = new Float64Array(n),
    h = new Float64Array(n);
  for (let i = 0; i < n; i++) if (sea[i]) blurredLevel[i] = datum;
  gaussianBlur(blurredBase, g.width, g.height, sigma / dx, sigma / dy);
  gaussianBlur(blurredLevel, g.width, g.height, sigma / dx, sigma / dy);
  for (let pass = 0; pass < calibrationPasses; pass++) {
    construct(network, increments, amplification, h, datum, state.evidence!);
    blurred.set(h);
    for (let i = 0; i < n; i++) if (sea[i]) blurred[i] = datum;
    gaussianBlur(blurred, g.width, g.height, sigma / dx, sigma / dy);
    for (let i = 0; i < n; i++) {
      if (sea[i]) continue;
      const wanted = blurredBase[i] - blurredLevel[i],
        got = blurred[i] - blurredLevel[i];
      if (wanted <= plainRelief) amplification[i] = minimumAmplification;
      else if (got > plainRelief)
        amplification[i] = clamp(
          amplification[i] * clamp(wanted / got, 0.4, 2.5),
          minimumAmplification,
          maximumAmplification
        );
    }
    gaussianBlur(amplification, g.width, g.height, sigma / dx / 2, sigma / dy / 2);
  }
  return amplification;
}

/** Build the surface upward from each root: tributaries rise from the water level they join. */
function construct(
  network: NetworkWork,
  { increment, step }: Increments,
  amplification: Float64Array,
  h: Float64Array,
  datum: number,
  evidence: Evidence
) {
  const { receiver, order, count, level, sea, base, lake } = network;
  for (let k = 0; k < count; k++) {
    const j = order[k],
      i = receiver[j];
    if (i < 0) {
      h[j] = rootHeight(network, evidence, j, datum);
      continue;
    }
    const from = lake[i] >= 0 ? level[i] : h[i];
    h[j] = from + increment[j] * amplification[j] + step[j];
  }
  for (let i = 0; i < h.length; i++) if (sea[i]) h[i] = Math.min(base[i], datum - 1);
}

/**
 * A root's height: a lake cell lies under its water, where the parent put its floor and at
 * least a few metres down; a sink or edge cell is the base; a shore cell rises just above
 * the datum.
 */
function rootHeight(network: NetworkWork, _evidence: Evidence, j: number, datum: number) {
  const { level, base, lake, sink } = network;
  if (lake[j] >= 0) return level[j] - Math.max(defaultLakeDepth, level[j] - base[j]);
  if (sink[j]) return base[j];
  return Math.max(level[j], datum + 1);
}

/**
 * Hillslopes are coupled sideways as well as down their own path: soil creeps across the
 * divide between two paths, so neighbouring slopes that drain to different channels meet in
 * a rounded interfluve instead of a wall. Channels and basins keep their own heights.
 */
function smoothHillslopes(state: RegionalState, h: Float64Array) {
  const g = state.surface,
    n = g.active.length,
    network = state.network!,
    around = new Int32Array(8),
    previous = new Float64Array(n),
    fixed = (i: number) =>
      network.sea[i] || network.channel[i] || network.lake[i] >= 0 || network.sink[i];
  for (let pass = 0; pass < hillslopePasses; pass++) {
    previous.set(h);
    for (let i = 0; i < n; i++) {
      if (fixed(i)) continue;
      const m = gridNeighbors(g.width, g.height, i, around);
      let sum = 0,
        weight = 0;
      for (let k = 0; k < m; k++) {
        if (network.sea[around[k]]) continue;
        sum += previous[around[k]];
        weight++;
      }
      if (weight) h[i] = (1 - hillslopeCoupling) * previous[i] + (hillslopeCoupling * sum) / weight;
    }
  }
}

/** Constructional relief: volcanic cones built on the surface they rose through. */
function buildCones(state: RegionalState, h: Float64Array) {
  const g = state.surface,
    sea = state.network!.sea,
    [dx, dy] = spacing(g);
  for (const cone of state.character?.cones ?? []) {
    const cx = cone.cell % g.width,
      cy = Math.floor(cone.cell / g.width),
      rx = Math.ceil(cone.radius / dx),
      ry = Math.ceil(cone.radius / dy);
    for (let y = Math.max(0, cy - ry); y <= Math.min(g.height - 1, cy + ry); y++)
      for (let x = Math.max(0, cx - rx); x <= Math.min(g.width - 1, cx + rx); x++) {
        const i = y * g.width + x,
          d = Math.hypot((x - cx) * dx, (y - cy) * dy);
        if (!sea[i] && d <= cone.radius) h[i] += cone.height * (1 - d / cone.radius) ** 1.5;
      }
  }
}

/** The derived surface drains along its network; only basins with a cause lie below their receiver. */
function keepDrainable(network: NetworkWork, h: Float64Array, basin: Uint8Array) {
  const { receiver, order, count, level, lake } = network;
  for (let k = 0; k < count; k++) {
    const j = order[k],
      i = receiver[j];
    if (i < 0 || basin[j]) continue;
    const floor = (lake[i] >= 0 ? level[i] : h[i]) + monotoneRise;
    if (h[j] < floor) h[j] = floor;
  }
}

/** Write the derived heights with the ledger's relief contributions on top. */
function writeSurface(state: RegionalState, h: Float64Array, datum: number) {
  const c = state.surface.channels,
    { sea, base } = state.network!,
    applied = state.contributions;
  for (let i = 0; i < h.length; i++) {
    if (sea[i]) {
      c.elevation.set(i, Math.min(base[i], datum - 1));
      continue;
    }
    c.elevation.set(i, h[i] + applied.appliedTo("elevation", i));
    c.erosion.set(i, Math.max(0, base[i] - h[i]));
  }
}

/**
 * Each seat's footprint holds the hillslope gradient down (spec 6.3): the valley floor
 * widens, a shoulder flattens into a bench, a col stays low. The footprint follows the
 * network's own geometry, so the shape is the seat's situation, not a disc.
 */
function seatCaps(state: RegionalState) {
  const g = state.surface,
    cap = new Float64Array(g.active.length),
    seats = (state.evidence?.seats ?? []).filter(
      (seat) => seat.strength === "established" || state.round >= 3
    );
  for (const seat of seats) {
    const cx = seat.cell % g.width,
      cy = Math.floor(seat.cell / g.width),
      r = seat.radius;
    for (let y = Math.max(0, cy - r); y <= Math.min(g.height - 1, cy + r); y++)
      for (let x = Math.max(0, cx - r); x <= Math.min(g.width - 1, cx + r); x++) {
        const i = y * g.width + x,
          d = Math.hypot(x - cx, y - cy);
        if (d > r + 0.5) continue;
        const gradient = d <= 1.5 ? seat.gradient * 0.6 : seat.gradient;
        cap[i] = cap[i] > 0 ? Math.min(cap[i], gradient) : gradient;
      }
  }
  return cap;
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

export { referenceDischarge };
