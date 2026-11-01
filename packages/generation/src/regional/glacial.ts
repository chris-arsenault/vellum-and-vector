import {
  channel,
  clamp,
  gridNeighbors,
  spacing,
  type ReliefWork,
  type RegionalState,
} from "./state";

/** Lapse of temperature with the height the relief gained over the captured base (°C/m). */
const lapse = 0.0065;
/** Temperature at which snow accumulates, and the span over which accumulation reaches full. */
const accumulationTemperature = -2,
  accumulationSpan = 8;
/** Melt per degree above the accumulation temperature, relative to full accumulation. */
const meltSpan = 8,
  meltStrength = 0.6;
/** Accumulation the recorded glacier is given where the record says ice was. */
const recordedAccumulation = 0.6,
  recordedFloor = 0.05;
/** Flux (in cells of full accumulation) a glacier gathers before it leaves its cirque. */
const cirqueFlux = 10;
/** Cirque depth at full strength: a share of the parent span, at least this many metres. */
const cirqueDepthShare = 0.012,
  cirqueDepthMinimum = 40;
/** Trough deepening per square root of flux beyond the cirque, and its limit, as shares of cirque depth. */
const troughShare = 0.4,
  troughLimit = 3;
/** Share of a trough's deepening its flanks take, giving the valley its U. */
const flankShare = 0.5;
/** Moraine height at a terminus, as a share of cirque depth. */
const moraineShare = 0.3;
/** Present ice thickness per square root of flux (m). */
const iceThicknessScale = 40;

interface IceBudget {
  accumulation: Float64Array;
  melt: Float64Array;
  cold: Uint8Array;
}

/**
 * Glaciation as a process on the derived surface (spec 6.1, 6.5 Aurora). Snow accumulates
 * where the lapsed climate is cold enough, and where the captured history says ice was; it
 * flows down the network, melting as it descends. Where the ice first gathers it hollows a
 * cirque behind a lip; where it runs full it deepens and widens a trough; where it ends it
 * leaves a moraine. Tarns, ribbon lakes and hanging heads follow from those shapes and the
 * water supply, not from a placement. Present ice is written for Aurora to hold its charge in.
 */
export function applyGlaciation(state: RegionalState, h: Float64Array, relief: ReliefWork) {
  const budget = iceBudget(state, h),
    { present, relict } = iceFlow(state, budget),
    depth = Math.max(cirqueDepthMinimum, cirqueDepthShare * state.parentSpan),
    flux = relief.iceFlux;
  for (let i = 0; i < flux.length; i++) flux[i] = Math.max(present[i], relict[i]);
  const lowering = carving(state, budget, flux, depth);
  cutTroughs(state, h, flux, lowering, depth, relief.basin);
  leaveMoraines(state, h, flux, depth);
  writeIce(state, present);
}

/** Accumulation and melt per cell from the lapsed climate, the record and Aurora's held ice. */
function iceBudget(state: RegionalState, h: Float64Array): IceBudget {
  const g = state.surface,
    n = g.active.length,
    { sea, base } = state.network!,
    [dx, dy] = spacing(g),
    cellArea = dx * dy,
    history = recorded(state),
    temperatureAt = lapsedTemperature(state, h, base),
    precipitationAt = precipitation(state),
    applied = state.contributions,
    accumulation = new Float64Array(n),
    melt = new Float64Array(n),
    cold = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (sea[i]) continue;
    const t = temperatureAt(i),
      // Aurora's held ice counts as accumulation the climate alone would not give.
      held = Math.max(0, applied.appliedTo("ice", i)),
      snow =
        clamp((accumulationTemperature - t) / accumulationSpan) * (0.3 + precipitationAt(i)) + held,
      share = g.measures.get(i) / cellArea;
    accumulation[i] = snow * share;
    melt[i] = clamp((t - accumulationTemperature) / meltSpan) * meltStrength * share;
    cold[i] = Number(snow > 0 || history[i] > recordedFloor);
  }
  return { accumulation, melt, cold };
}

/** The recorded glacial reworking, or none. */
function recorded(state: RegionalState) {
  return state.character?.reworking ?? new Float64Array(state.surface.active.length);
}
/** Captured temperature lapsed over the height the relief gained, with magic's heat on top. */
function lapsedTemperature(state: RegionalState, h: Float64Array, base: Float64Array) {
  const temperature = state.natural.temperature ?? state.surface.channels.temperature,
    applied = state.contributions;
  return (i: number) =>
    (temperature?.get(i) ?? 15) - lapse * (h[i] - base[i]) + applied.appliedTo("temperature", i);
}
function precipitation(state: RegionalState) {
  const c = state.surface.channels;
  return (i: number) => (c.rainfall?.get(i) ?? 0.8) + (c.snowfall?.get(i) ?? 0);
}

/**
 * Ice flows down the network. The present glacier melts as it descends; the recorded one
 * reached exactly as far as the record says.
 */
function iceFlow(state: RegionalState, { accumulation, melt }: IceBudget) {
  const g = state.surface,
    n = g.active.length,
    { receiver, order, count } = state.network!,
    [dx, dy] = spacing(g),
    cellArea = dx * dy,
    history = recorded(state),
    present = new Float64Array(n),
    relict = new Float64Array(n);
  for (let k = count - 1; k >= 0; k--) {
    const i = order[k],
      j = receiver[i],
      flowing = present[i] > 0 || accumulation[i] > 0;
    present[i] = Math.max(0, present[i] + accumulation[i] - (flowing ? melt[i] : 0));
    relict[i] =
      history[i] > recordedFloor
        ? relict[i] + history[i] * recordedAccumulation * (g.measures.get(i) / cellArea)
        : 0;
    if (j < 0) continue;
    present[j] += present[i];
    relict[j] += relict[i];
  }
  return { present, relict };
}

/** How much each cell is cut: a cirque hollow where ice gathers, a trough where it runs full. */
function carving(
  state: RegionalState,
  { accumulation, cold }: IceBudget,
  flux: Float64Array,
  depth: number
) {
  const network = state.network!,
    history = recorded(state),
    lowering = new Float64Array(flux.length),
    uncut = (i: number) => network.sea[i] || flux[i] <= 0 || network.lake[i] >= 0;
  for (let i = 0; i < flux.length; i++) {
    if (uncut(i)) continue;
    const strength = clamp(Math.max(history[i], accumulation[i])),
      f = flux[i] / cirqueFlux;
    // The hollow is deepest midway between the headwall and the lip at the cirque's mouth;
    // beyond it the full glacier cuts its trough.
    if (f < 1) lowering[i] = cold[i] ? depth * 4 * f * (1 - f) * strength : 0;
    else if (network.channel[i] || f >= 2)
      lowering[i] = Math.min(troughLimit, troughShare * Math.sqrt(f - 1)) * depth * strength;
  }
  return lowering;
}

/**
 * Apply the cuts. Troughs take their flanks with them; a cirque floor and a trough floor
 * may lie below the lip and the moraine that close them.
 */
function cutTroughs(
  state: RegionalState,
  h: Float64Array,
  flux: Float64Array,
  lowering: Float64Array,
  depth: number,
  basin: Uint8Array
) {
  const g = state.surface,
    n = g.active.length,
    sea = state.network!.sea,
    flank = troughFlanks(state, flux, lowering),
    sediment = g.channels.sediment,
    applied = state.contributions;
  for (let i = 0; i < n; i++) {
    if (lowering[i] > 0.25 * depth || (lowering[i] > 0 && flux[i] >= cirqueFlux)) basin[i] = 1;
    if (sea[i]) continue;
    h[i] -= lowering[i] + flank[i];
    sediment.set(i, applied.appliedTo("sediment", i));
  }
}

/** The lowering a trough's uncut neighbours take with it. */
function troughFlanks(state: RegionalState, flux: Float64Array, lowering: Float64Array) {
  const g = state.surface,
    sea = state.network!.sea,
    around = new Int32Array(8),
    flank = new Float64Array(flux.length);
  for (let i = 0; i < flux.length; i++) {
    if (lowering[i] <= 0 || flux[i] < cirqueFlux) continue;
    const m = gridNeighbors(g.width, g.height, i, around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (!sea[j] && lowering[j] <= 0) flank[j] = Math.max(flank[j], lowering[i] * flankShare);
    }
  }
  return flank;
}

/** The terminus: the ice dropped its load where it ended. */
function leaveMoraines(state: RegionalState, h: Float64Array, flux: Float64Array, depth: number) {
  const { receiver, sea } = state.network!,
    sediment = state.surface.channels.sediment;
  for (let i = 0; i < flux.length; i++) {
    if (sea[i] || flux[i] < cirqueFlux * 0.5) continue;
    const j = receiver[i];
    if (j < 0 || sea[j] || flux[j] > 0) continue;
    const moraine = moraineShare * depth * clamp(flux[i] / cirqueFlux);
    h[j] += moraine;
    sediment.add(j, moraine);
  }
}

/** Present ice for Aurora, with the ledger's held ice on top. */
function writeIce(state: RegionalState, present: Float64Array) {
  const c = state.surface.channels,
    ice = channel(state, "ice", "ratio"),
    applied = state.contributions;
  for (let i = 0; i < present.length; i++) {
    const thickness = present[i] > 0 ? iceThicknessScale * Math.sqrt(present[i] / cirqueFlux) : 0;
    ice.set(i, clamp(thickness / 1000 + applied.appliedTo("ice", i)));
    if (c.iceThickness) c.iceThickness.set(i, ice.get(i) * 1000);
  }
}
