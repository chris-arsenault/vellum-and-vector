import { units } from "../canonry/math";
import {
  isContent,
  neighborhood,
  neighborhoodCapacity,
  neighborsOf,
  regionalSpan,
} from "./lattice";
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
/** Ice thickness (m) per square root of the ice-covered area feeding a cell (km²), and its bound. */
const iceThicknessScale = 40,
  iceThicknessLimit = 600;
/** Meltwater (m/yr) a fully warm ice surface yields. */
const meltYield = 1;

interface IceBudget {
  accumulation: Float64Array;
  melt: Float64Array;
  /** How far above the accumulation temperature each cell stands, 0..1. */
  warmth: Float64Array;
  cold: Uint8Array;
}

/**
 * Glaciation as a process on the derived surface (spec 6.1, 6.5 Aurora). Snow accumulates
 * where the lapsed climate is cold enough, and where the captured history says ice was; the
 * present ice flows down its own surface (bed plus thickness), so a glacier crosses a col
 * when its surface stands above it, melting as it descends; the recorded ice ran the network.
 * Where the ice first gathers it hollows a cirque behind a lip; where it runs full it deepens
 * and widens a trough; where it ends it leaves a moraine. Present ice is written for Aurora
 * to hold its charge in, its melt for the runoff, its cut for the landform readers.
 */
export function applyGlaciation(state: RegionalState, h: Float64Array, relief: ReliefWork) {
  const budget = iceBudget(state, h),
    { present, thickness, target } = surfaceFlow(state, budget, h),
    relict = relictFlow(state),
    depth = cirqueDepth,
    flux = relief.iceFlux;
  for (let i = 0; i < flux.length; i++) flux[i] = Math.max(present[i], relict[i]);
  const lowering = carving(state, budget, flux, depth);
  cutTroughs(state, h, flux, lowering, depth, relief.basin);
  leaveMoraines(state, h, flux, depth, target);
  writeIce(state, thickness, budget);
}

/** The captured temperature in °C at a cell. */
export function capturedCelsius(state: RegionalState, i: number) {
  return naturalBand(state, "Temperature").get(i) / 10 - 30;
}
/** Magic's applied heat at a cell, in °C: the workspace's replace-contribution. */
export function magicHeat(state: RegionalState, i: number) {
  return (state.physical.magic?.heat.get(i) ?? 0) / 10;
}

/** Accumulation and melt per cell from the lapsed climate (the local snowline) and the record. */
function iceBudget(state: RegionalState, h: Float64Array): IceBudget {
  const map = state.physical.map,
    mesh = map.mesh,
    n = mesh.count,
    { sea, base } = state.regional.network!,
    cellArea = regionalSpan(state) ** 2,
    history = recorded(state),
    accumulation = new Float64Array(n),
    melt = new Float64Array(n),
    warmth = new Float64Array(n),
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
    warmth[i] = clamp((t - accumulationTemperature) / meltSpan);
    // Charge a system holds in the ground keeps its ice (plan M5): the melt it allows.
    melt[i] = warmth[i] * meltStrength * share * (1 - clamp(map.IcePersistence.get(i)));
    cold[i] = Number(snow > 0 || history[i] > recordedFloor);
  }
  return { accumulation, melt, warmth, cold };
}

/** The recorded glacial reworking, or none. */
function recorded(state: RegionalState) {
  return state.regional.character?.reworking ?? new Float64Array(state.physical.map.mesh.count);
}

/**
 * The present glacier flows down the steepest descent of its own surface, bed plus thickness,
 * over the neighbourhood: two passes, the first on the bare bed, the second on the ice the
 * first gathered, so a glacier that fills its valley spills over the col into the next.
 * Thickness grows with the square root of the ice-covered area feeding the cell.
 */
function surfaceFlow(state: RegionalState, { accumulation, melt }: IceBudget, h: Float64Array) {
  const mesh = state.physical.map.mesh,
    n = mesh.count,
    sea = state.regional.network!.sea,
    cellArea = regionalSpan(state) ** 2,
    present = new Float64Array(n),
    thickness = new Float64Array(n),
    surface = new Float64Array(n),
    target = new Int32Array(n).fill(-1),
    around = new Int32Array(neighborhoodCapacity(mesh)),
    land: number[] = [];
  for (let i = 0; i < n; i++) if (isContent(mesh, i) && !sea[i]) land.push(i);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) surface[i] = h[i] + thickness[i];
    land.sort((a, b) => surface[b] - surface[a] || a - b);
    present.fill(0);
    target.fill(-1);
    for (const i of land) {
      gather(present, accumulation, melt, i);
      if (present[i] <= 0) continue;
      const j = steepestDescent(mesh, surface, sea, i, around);
      target[i] = j;
      if (j >= 0) present[j] += present[i];
    }
    for (const i of land)
      thickness[i] = Math.min(
        iceThicknessLimit,
        iceThicknessScale * Math.sqrt((present[i] * cellArea) / 1e6)
      );
  }
  return { present, thickness, target };
}
/** A cell's ice: what arrived plus its own snow, less its melt once ice is flowing there. */
function gather(present: Float64Array, accumulation: Float64Array, melt: Float64Array, i: number) {
  const flowing = present[i] > 0 || accumulation[i] > 0;
  present[i] = Math.max(0, present[i] + accumulation[i] - (flowing ? melt[i] : 0));
}
/** The content land neighbour the surface falls to most steeply, or -1 at a low point. */
function steepestDescent(
  mesh: RegionalState["physical"]["map"]["mesh"],
  surface: Float64Array,
  sea: Uint8Array,
  i: number,
  around: Int32Array
) {
  const m = neighborhood(mesh, i, around);
  let best = -1,
    steepest = 0;
  for (let k = 0; k < m; k++) {
    const j = around[k];
    if (sea[j] || !isContent(mesh, j)) continue;
    const slope =
      (surface[i] - surface[j]) / Math.hypot(mesh.x(i) - mesh.x(j), mesh.y(i) - mesh.y(j));
    if (slope > steepest) {
      steepest = slope;
      best = j;
    }
  }
  return best;
}

/** The recorded glacier reached exactly as far down the network as the record says. */
function relictFlow(state: RegionalState) {
  const mesh = state.physical.map.mesh,
    n = mesh.count,
    { receiver, order, count } = state.regional.network!,
    cellArea = regionalSpan(state) ** 2,
    history = recorded(state),
    relict = new Float64Array(n);
  for (let k = count - 1; k >= 0; k--) {
    const i = order[k],
      j = receiver[i];
    relict[i] =
      history[i] > recordedFloor
        ? relict[i] + history[i] * recordedAccumulation * (mesh.contentArea(i) / cellArea)
        : 0;
    if (j >= 0) relict[j] += relict[i];
  }
  return relict;
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
 * from the captured thickness plus the ledger, so moraines are placed, not stacked; the
 * glacial cut is booked on the captured glacial erosion for the landform readers.
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
    erosion = naturalBand(state, "CumulativeGlacialErosion"),
    applied = state.regional.contributions;
  for (let i = 0; i < n; i++) {
    if (lowering[i] > 0.25 * depth || (lowering[i] > 0 && flux[i] >= cirqueFlux)) basin[i] = 1;
    if (sea[i] || !isContent(mesh, i)) continue;
    h[i] -= lowering[i] + flank[i];
    map.SedimentThickness.set(
      i,
      Math.max(0, natural.get(i) + Math.round(applied.appliedTo("SedimentThickness", i)))
    );
    map.CumulativeGlacialErosion.set(i, erosion.get(i) + units(lowering[i] + flank[i]));
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
function leaveMoraines(
  state: RegionalState,
  h: Float64Array,
  flux: Float64Array,
  depth: number,
  target: Int32Array
) {
  const map = state.physical.map,
    { receiver, sea } = state.regional.network!;
  for (let i = 0; i < flux.length; i++) {
    if (sea[i] || flux[i] < cirqueFlux * 0.5) continue;
    // The present glacier ends where its own surface sent it; the recorded one where the network did.
    const j = target[i] >= 0 ? target[i] : receiver[i];
    if (j < 0 || sea[j] || flux[j] > 0) continue;
    const moraine = moraineShare * depth * clamp(flux[i] / cirqueFlux);
    h[j] += moraine;
    map.SedimentThickness.add(j, units(moraine));
  }
}

/**
 * Present ice (m) for Aurora, with the ledger's held ice on top, and the meltwater (mm/yr) a
 * warm ice surface yields to the runoff. Sea cells keep the captured sea ice; only land is
 * re-derived.
 */
function writeIce(state: RegionalState, thickness: Float64Array, { warmth }: IceBudget) {
  const map = state.physical.map,
    mesh = map.mesh,
    sea = state.regional.network!.sea,
    applied = state.regional.contributions;
  for (let i = 0; i < thickness.length; i++) {
    if (sea[i] || !isContent(mesh, i)) continue;
    map.IceThickness.set(i, Math.max(0, thickness[i] + applied.appliedTo("IceThickness", i)));
    const iced = map.IceThickness.get(i) > 0;
    map.GroundedIce.set(i, Number(iced));
    map.GlacialMeltwater.set(i, iced ? Math.round(1000 * meltYield * warmth[i]) : 0);
  }
}
