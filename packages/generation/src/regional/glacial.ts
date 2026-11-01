import { units } from "../canonry/math";
import { isContent, neighborsOf, regionalSpan } from "./lattice";
import { clamp, naturalBand, type ReliefWork, type RegionalState } from "./state";

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
/** Cirque depth at full strength (m): a physical size, the same at every refinement level. */
const cirqueDepth = 120;
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
    depth = cirqueDepth,
    flux = relief.iceFlux;
  for (let i = 0; i < flux.length; i++) flux[i] = Math.max(present[i], relict[i]);
  const lowering = carving(state, budget, flux, depth);
  cutTroughs(state, h, flux, lowering, depth, relief.basin);
  leaveMoraines(state, h, flux, depth);
  writeIce(state, present);
}

/** The captured temperature in °C at a cell. */
export function capturedCelsius(state: RegionalState, i: number) {
  return naturalBand(state, "Temperature").get(i) / 10 - 30;
}
/** Magic's applied heat at a cell, in °C: the workspace's replace-contribution. */
export function magicHeat(state: RegionalState, i: number) {
  return (state.physical.magic?.heat.get(i) ?? 0) / 10;
}

/** Accumulation and melt per cell from the lapsed climate, the record and Aurora's held ice. */
function iceBudget(state: RegionalState, h: Float64Array): IceBudget {
  const map = state.physical.map,
    mesh = map.mesh,
    n = mesh.count,
    { sea, base } = state.regional.network!,
    cellArea = regionalSpan(state) ** 2,
    history = recorded(state),
    accumulation = new Float64Array(n),
    melt = new Float64Array(n),
    cold = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (sea[i] || !isContent(mesh, i)) continue;
    // Aurora's held ice is the ledger's contribution to the written thickness (once, in
    // `writeIce`); it is not snow that flows and carves. M5 decides whether it should.
    const t = capturedCelsius(state, i) - lapse * (h[i] - base[i]) + magicHeat(state, i),
      precipitation = (map.Rainfall.get(i) + map.Snowfall.get(i)) / 1000,
      snow = clamp((accumulationTemperature - t) / accumulationSpan) * (0.3 + precipitation),
      share = mesh.contentArea(i) / cellArea;
    accumulation[i] = snow * share;
    melt[i] = clamp((t - accumulationTemperature) / meltSpan) * meltStrength * share;
    cold[i] = Number(snow > 0 || history[i] > recordedFloor);
  }
  return { accumulation, melt, cold };
}

/** The recorded glacial reworking, or none. */
function recorded(state: RegionalState) {
  return state.regional.character?.reworking ?? new Float64Array(state.physical.map.mesh.count);
}

/**
 * Ice flows down the network. The present glacier melts as it descends; the recorded one
 * reached exactly as far as the record says.
 */
function iceFlow(state: RegionalState, { accumulation, melt }: IceBudget) {
  const mesh = state.physical.map.mesh,
    n = mesh.count,
    { receiver, order, count } = state.regional.network!,
    cellArea = regionalSpan(state) ** 2,
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
        ? relict[i] + history[i] * recordedAccumulation * (mesh.contentArea(i) / cellArea)
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
  const network = state.regional.network!,
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
 * may lie below the lip and the moraine that close them. Sediment starts each derivation
 * from the captured thickness plus the ledger, so moraines are placed, not stacked.
 */
function cutTroughs(
  state: RegionalState,
  h: Float64Array,
  flux: Float64Array,
  lowering: Float64Array,
  depth: number,
  basin: Uint8Array
) {
  const map = state.physical.map,
    mesh = map.mesh,
    n = mesh.count,
    sea = state.regional.network!.sea,
    flank = troughFlanks(state, flux, lowering),
    natural = naturalBand(state, "SedimentThickness"),
    applied = state.regional.contributions;
  for (let i = 0; i < n; i++) {
    if (lowering[i] > 0.25 * depth || (lowering[i] > 0 && flux[i] >= cirqueFlux)) basin[i] = 1;
    if (sea[i] || !isContent(mesh, i)) continue;
    h[i] -= lowering[i] + flank[i];
    map.SedimentThickness.set(
      i,
      Math.max(0, natural.get(i) + Math.round(applied.appliedTo("SedimentThickness", i)))
    );
  }
}

/** The lowering a trough's uncut neighbours take with it. */
function troughFlanks(state: RegionalState, flux: Float64Array, lowering: Float64Array) {
  const mesh = state.physical.map.mesh,
    sea = state.regional.network!.sea,
    around = new Int32Array(mesh.stride),
    flank = new Float64Array(flux.length);
  for (let i = 0; i < flux.length; i++) {
    if (lowering[i] <= 0 || flux[i] < cirqueFlux) continue;
    const m = neighborsOf(mesh, i, around);
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (!sea[j] && lowering[j] <= 0) flank[j] = Math.max(flank[j], lowering[i] * flankShare);
    }
  }
  return flank;
}

/** The terminus: the ice dropped its load where it ended. */
function leaveMoraines(state: RegionalState, h: Float64Array, flux: Float64Array, depth: number) {
  const map = state.physical.map,
    { receiver, sea } = state.regional.network!;
  for (let i = 0; i < flux.length; i++) {
    if (sea[i] || flux[i] < cirqueFlux * 0.5) continue;
    const j = receiver[i];
    if (j < 0 || sea[j] || flux[j] > 0) continue;
    const moraine = moraineShare * depth * clamp(flux[i] / cirqueFlux);
    h[j] += moraine;
    map.SedimentThickness.add(j, units(moraine));
  }
}

/**
 * Present ice (m) for Aurora, with the ledger's held ice on top. Sea cells keep the captured
 * sea ice; only land is re-derived.
 */
function writeIce(state: RegionalState, present: Float64Array) {
  const map = state.physical.map,
    mesh = map.mesh,
    sea = state.regional.network!.sea,
    applied = state.regional.contributions;
  for (let i = 0; i < present.length; i++) {
    if (sea[i] || !isContent(mesh, i)) continue;
    const thickness = present[i] > 0 ? iceThicknessScale * Math.sqrt(present[i] / cirqueFlux) : 0;
    map.IceThickness.set(i, Math.max(0, thickness + applied.appliedTo("IceThickness", i)));
    map.GroundedIce.set(i, Number(map.IceThickness.get(i) > 0));
  }
}
