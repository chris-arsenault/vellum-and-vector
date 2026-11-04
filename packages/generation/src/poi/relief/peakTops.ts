import { Landform } from "../../canonry/codes";
import { hashUnit } from "../../canonry/noise";
import { keyCols, leastRise, prominence } from "../../canonry/landforms";
import { rangeGroups } from "../../canonry/reliefFeatures";
import type { GenerationState } from "../../process";
import type { RegionalState } from "../../regional/state";
import { mapScale } from "../../worldSignificance";
import { carriedPlaces } from "../poiPublish";
import {
  cellSpan,
  cellsWithin,
  fieldOf,
  heightAt,
  gap,
  heldFor,
  isLand,
  isSea,
  releaseHeld,
} from "../poiReads";
import { settlementPlaces } from "../settlements/communityRecords";
import { peopleOfRecord } from "../settlements/settlementRecords";

/**
 * Why a top is a peak. Height is one reason among several: a range's highest point is a peak
 * however it rises, a town can make a modest top the mountain it lives under, and sailors can
 * make one of the headland they steer by. This is the one definition of a peak: the place, the
 * landform and a range's count all read it.
 */
export type PeakCause = "crown" | "carried" | "high" | "lone" | "seaMark" | "horn" | "town";
type Chosen = Map<number, PeakCause>;

/** Rise in metres at the World's scale that makes a top a peak within a range and alone. */
const rangeRise = 400,
  loneRise = 900,
  seaMarkRise = 300,
  /** How far a pass's lesser top must rise for the higher one to be known as its horn. */
  hornRise = 1200;
/** The share of its range's relief a top must rise to stand among its range's peaks. */
const rangeShare = 0.25;
/** How far apart peaks of each sort stand, in this map's cell spans. */
const rangeApart = 3,
  loneApart = 5,
  seaMarkApart = 8,
  hornApart = 4;
/** How much of a town's country it looks to for its mountain, in cell spans and metres. */
const townSpans = 3,
  townMetres = 15_000;
/** The chance a pass names its horn, and a town of no great size its mountain. */
const hornChance = 0.3,
  townChance = 0.1,
  bigTownChance = 0.5,
  bigTown = 2000,
  seatChance = 0.9;
const seats = new Set(["capital", "regionalCapital"]);
const salts = { horn: 0x7011, town: 0x7012 };

const riseOf = (state: GenerationState) =>
  heldFor(state, "prominence", () => prominence(fieldOf(state)));
const metresOf = (state: GenerationState, cell: number) => riseOf(state).get(cell) / 1024;
/** A height at the World's scale, at this map's scale. */
const scaled = (state: GenerationState, height: number) => height * mapScale(state).height;

/** Every land cell that tops out at least the least rise, greatest rise first. */
const candidates = (state: GenerationState): readonly number[] =>
  heldFor(state, "peak:candidates", () => {
    const mesh = fieldOf(state).mesh,
      rise = riseOf(state),
      found: number[] = [];
    for (let cell = 0; cell < mesh.count; cell++)
      if (mesh.membership(cell) === 1 && isLand(state, cell) && rise.get(cell) >= leastRise)
        found.push(cell);
    return found.sort((a, b) => rise.get(b) - rise.get(a) || a - b);
  });
const highestRising = (state: GenerationState, cells: readonly number[]) => {
  const rise = riseOf(state);
  let best = -1;
  for (const cell of cells)
    if (rise.get(cell) >= leastRise && (best < 0 || rise.get(cell) > rise.get(best))) best = cell;
  return best;
};

const clear = (state: GenerationState, chosen: Chosen, cell: number, apart: number) => {
  for (const other of chosen.keys()) if (gap(state, cell, other) < apart) return false;
  return true;
};
/** The tallest point of a range is always a peak, whatever it rises above its col. */
function crowns(state: GenerationState, chosen: Chosen) {
  const elevation = fieldOf(state).Elevation;
  for (const { members } of rangeGroups(state)) {
    let crown = members[0];
    for (const cell of members) if (elevation.get(cell) > elevation.get(crown)) crown = cell;
    chosen.set(crown, "crown");
  }
}
/** A peak the coarser map named stays one: the greatest top within its cell. */
function carried(state: GenerationState, chosen: Chosen) {
  if (!("regional" in state)) return;
  const region = state as RegionalState;
  for (const { entry, carried: place } of carriedPlaces(region)) {
    if (entry.id !== "peak") continue;
    const top = highestRising(state, cellsWithin(state, place.cell, region.regional.parentSpan));
    if (top >= 0 && !chosen.has(top)) chosen.set(top, "carried");
  }
}
/** Among a range's other tops, those that rule their part of it. */
function high(state: GenerationState, chosen: Chosen) {
  const span = cellSpan(state),
    apart = rangeApart * span,
    bars = new Map<number, number>();
  for (const { members, relief } of rangeGroups(state)) {
    const bar = Math.max(scaled(state, rangeRise), rangeShare * relief);
    for (const cell of members) bars.set(cell, bar);
  }
  for (const cell of candidates(state)) {
    const bar = bars.get(cell);
    if (bar !== undefined && metresOf(state, cell) >= bar && clear(state, chosen, cell, apart))
      chosen.set(cell, "high");
  }
}
/** Out of any range, a top must stand well clear of the country around it. */
function lone(state: GenerationState, chosen: Chosen) {
  const inRange = new Set(rangeGroups(state).flatMap(({ members }) => [...members])),
    apart = loneApart * cellSpan(state),
    bar = scaled(state, loneRise);
  for (const cell of candidates(state))
    if (!inRange.has(cell) && metresOf(state, cell) >= bar && clear(state, chosen, cell, apart))
      chosen.set(cell, "lone");
}
/** A top rising straight from the sea is what sailors steer by, though nobody would climb it. */
function seaMarks(state: GenerationState, chosen: Chosen) {
  const span = cellSpan(state),
    bar = scaled(state, seaMarkRise);
  for (const cell of candidates(state)) {
    if (metresOf(state, cell) < bar || !clear(state, chosen, cell, seaMarkApart * span)) continue;
    if (cellsWithin(state, cell, 2 * span).some((near) => isSea(state, near)))
      chosen.set(cell, "seaMark");
  }
}
/** A great crossing is known by the top above it: some passes name their horn. */
function horns(state: GenerationState, chosen: Chosen) {
  const span = cellSpan(state),
    bar = scaled(state, hornRise) * 1024;
  for (const [col, rise] of keyCols(fieldOf(state))) {
    if (rise < bar || hashUnit(salts.horn, col, 0) >= hornChance) continue;
    const top = highestRising(state, cellsWithin(state, col, hornApart * span));
    if (top >= 0 && clear(state, chosen, top, hornApart * span)) chosen.set(top, "horn");
  }
}
function townChanceOf(role: unknown, people: number) {
  if (seats.has(String(role))) return seatChance;
  return townChance + (bigTownChance * people) / (people + bigTown);
}
/** People name what they live under: a mountain town sometimes makes its nearest top a peak. */
function towns(state: GenerationState, chosen: Chosen) {
  const hills = state.physical!.profile.HillElevation,
    reach = Math.max(townSpans * cellSpan(state), townMetres);
  for (const town of settlementPlaces(state)) {
    if (town.anchor < 0 || heightAt(state, town.anchor) < hills) continue;
    const record = town.feature,
      chance = townChanceOf(record?.attributes.settlementRole, record ? peopleOfRecord(record) : 0);
    if (hashUnit(salts.town, town.anchor, 0) >= chance) continue;
    const top = highestRising(state, cellsWithin(state, town.anchor, reach));
    if (top >= 0 && !chosen.has(top)) chosen.set(top, "town");
  }
}
/** Every peak on this map and why it is one; what is not here stays a latent top. */
export const peakTops = (state: GenerationState): ReadonlyMap<number, PeakCause> =>
  heldFor(state, "peak:tops", () => {
    const chosen: Chosen = new Map();
    if (!state.physical) return chosen;
    crowns(state, chosen);
    carried(state, chosen);
    high(state, chosen);
    lone(state, chosen);
    seaMarks(state, chosen);
    horns(state, chosen);
    towns(state, chosen);
    return chosen;
  });

/** The terrain's landform mark: a peak is a peak, whichever reader asks. */
export function markPeakLandforms(state: GenerationState) {
  releaseHeld(state);
  const codes = fieldOf(state).LandformCodes;
  for (const cell of peakTops(state).keys())
    if (isLand(state, cell) && codes.get(cell) !== Landform.Waterfall)
      codes.set(cell, Landform.Peak);
  releaseHeld(state);
}
