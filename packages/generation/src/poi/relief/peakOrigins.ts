import { keyCols, leastRise, prominence } from "../../canonry/landforms";
import { hashUnit } from "../../canonry/noise";
import { rangeGroups } from "../../canonry/rangeGroups";
import type { GenerationState } from "../../process";
import type { RegionalState } from "../../regional/state";
import { mapScale } from "../../worldSignificance";
import type { PoiClaim, PoiOrigin } from "../poiContract";
import { carriedPlaces } from "../poiPublish";
import { cellSpan, cellsWithin, fieldOf, gap, heightAt, heldFor, isLand, isSea } from "../poiReads";
import { settlementPlaces } from "../settlements/communityRecords";
import { peopleOfRecord } from "../settlements/settlementRecords";

type Claimed = ReadonlyMap<number, PoiClaim>;

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
const clear = (state: GenerationState, taken: Iterable<number>, cell: number, apart: number) => {
  for (const other of taken) if (gap(state, cell, other) < apart) return false;
  return true;
};
/** Those of the candidates that pass, each standing clear of every peak before it. */
function spaced(
  state: GenerationState,
  claimed: Claimed,
  apart: number,
  passes: (cell: number) => boolean
) {
  const taken = new Set(claimed.keys());
  for (const cell of candidates(state))
    if (passes(cell) && clear(state, taken, cell, apart)) taken.add(cell);
  return [...taken].filter((cell) => !claimed.has(cell)).map((anchor) => ({ anchor }));
}

/** The tallest point of a range is always a peak, whatever it rises above its col. */
function crowns(state: GenerationState) {
  const elevation = fieldOf(state).Elevation;
  return rangeGroups(state).map(({ members }) => {
    let crown = members[0];
    for (const cell of members) if (elevation.get(cell) > elevation.get(crown)) crown = cell;
    return { anchor: crown };
  });
}
/** A peak the coarser map named stays one: the greatest top within its cell. */
function carried(state: GenerationState) {
  if (!("regional" in state)) return [];
  const region = state as RegionalState;
  return carriedPlaces(region)
    .filter(({ entry }) => entry.id === "peak")
    .map(({ carried: place }) =>
      highestRising(state, cellsWithin(state, place.cell, region.regional.parentSpan))
    )
    .filter((top) => top >= 0)
    .map((anchor) => ({ anchor }));
}
/** Among a range's other tops, those that rule their part of it. */
function high(state: GenerationState, claimed: Claimed) {
  const bars = new Map<number, number>();
  for (const { members, relief } of rangeGroups(state)) {
    const bar = Math.max(scaled(state, rangeRise), rangeShare * relief);
    for (const cell of members) bars.set(cell, bar);
  }
  return spaced(state, claimed, rangeApart * cellSpan(state), (cell) => {
    const bar = bars.get(cell);
    return bar !== undefined && metresOf(state, cell) >= bar;
  });
}
/** Out of any range, a top must stand well clear of the country around it. */
function lone(state: GenerationState, claimed: Claimed) {
  const inRange = new Set(rangeGroups(state).flatMap(({ members }) => [...members])),
    bar = scaled(state, loneRise);
  return spaced(
    state,
    claimed,
    loneApart * cellSpan(state),
    (cell) => !inRange.has(cell) && metresOf(state, cell) >= bar
  );
}
/** A top rising straight from the sea is what sailors steer by, though nobody would climb it. */
function seaMarks(state: GenerationState, claimed: Claimed) {
  const span = cellSpan(state),
    bar = scaled(state, seaMarkRise);
  return spaced(
    state,
    claimed,
    seaMarkApart * span,
    (cell) =>
      metresOf(state, cell) >= bar &&
      cellsWithin(state, cell, 2 * span).some((near) => isSea(state, near))
  );
}
/** A great crossing is known by the top above it: some passes name their horn. */
function horns(state: GenerationState, claimed: Claimed) {
  const span = cellSpan(state),
    bar = scaled(state, hornRise) * 1024,
    taken = new Set(claimed.keys()),
    found: { anchor: number }[] = [];
  for (const [col, rise] of keyCols(fieldOf(state))) {
    if (rise < bar || hashUnit(salts.horn, col, 0) >= hornChance) continue;
    const top = highestRising(state, cellsWithin(state, col, hornApart * span));
    if (top < 0 || !clear(state, taken, top, hornApart * span)) continue;
    taken.add(top);
    found.push({ anchor: top });
  }
  return found;
}
function townChanceOf(role: unknown, people: number) {
  if (seats.has(String(role))) return seatChance;
  return townChance + (bigTownChance * people) / (people + bigTown);
}
/** People name what they live under: a mountain town sometimes makes its nearest top a peak. */
function towns(state: GenerationState) {
  const hills = state.physical!.profile.HillElevation,
    reach = Math.max(townSpans * cellSpan(state), townMetres);
  return settlementPlaces(state).flatMap((town) => {
    if (town.anchor < 0 || heightAt(state, town.anchor) < hills) return [];
    const record = town.feature,
      chance = townChanceOf(record?.attributes.settlementRole, record ? peopleOfRecord(record) : 0);
    if (hashUnit(salts.town, town.anchor, 0) >= chance) return [];
    const top = highestRising(state, cellsWithin(state, town.anchor, reach));
    return top >= 0 ? [{ anchor: top }] : [];
  });
}

/** Why a top is a peak, in order of claim. Height is one reason among several. */
export const peakOrigins: readonly PoiOrigin[] = [
  {
    id: "crown",
    statement: "The tallest point of a range, however it rises.",
    reads: [],
    finds: crowns,
  },
  {
    id: "carried",
    statement: "The greatest top where the coarser map named a peak.",
    reads: [],
    finds: carried,
  },
  { id: "high", statement: "A top ruling its part of a range.", reads: [], finds: high },
  { id: "lone", statement: "A top standing well clear of its country.", reads: [], finds: lone },
  {
    id: "seaMark",
    statement: "A top rising from the sea that sailors steer by.",
    reads: [],
    finds: seaMarks,
  },
  { id: "horn", statement: "The top a great crossing is known by.", reads: [], finds: horns },
  {
    id: "town",
    statement: "The mountain a town in the hills lives under, by chance and by its size.",
    reads: ["settlement"],
    finds: towns,
  },
];
