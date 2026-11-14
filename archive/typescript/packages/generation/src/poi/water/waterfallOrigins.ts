import { isRiverStep, riverDrop } from "../../world/landforms";
import { hostedCell, linkOn } from "../../area/areaHosting";
import { riversOf } from "../../area/riverCourses";
import { hashUnit } from "../../world/noise";
import type { GenerationState } from "../../process";
import type { RegionalState } from "../../regional/state";
import { groundOf } from "../../rock/ground";
import { surfaceResistance } from "../../rock/groundQueries";
import { mapScale } from "../../worldSignificance";
import type { PoiClaim, PoiOrigin } from "../poiContract";
import { spacedAmong } from "../poiOrigins";
import { carriedPlaces } from "../poiPublish";
import {
  cellSpan,
  cellsWithin,
  dischargeAt,
  fieldOf,
  fractureAt,
  heldFor,
  isLake,
  isSea,
} from "../poiReads";
import { settlementPlaces } from "../settlements/communityRecords";
import { sizeAtCell } from "./waterfallShape";
import { flowTarget } from "./waterReads";

type Claimed = ReadonlyMap<number, PoiClaim>;

/** How far apart falls stand, in cell spans: a steep reach is one fall, not a row of them. */
const fallsApart = 3;
/** How tall a fall really is, in metres at the World's scale, to need no other reason. */
// length-unit: fraction
const greatHeight = 0.000025;
/** How much harder a lip's rock must be than the rock below it to hold a ledge. */
const ledgeContrast = 150;
/** Fracture in [0, 1] at which the ground has moved along a fault. */
const faulted = 0.35;
/** How much more water the river it joins carries, for a tributary to hang above it. */
const hangingShare = 4;
/** How near a town stands to a step to portage round it, in cell spans, and how many name it. */
const portageSpans = 2,
  portageChance = 0.5;
const salt = 0x7041;

/** Every step on this map's rivers, tallest first. No rivers, no steps. */
export const stepsOf = (state: GenerationState): readonly number[] =>
  heldFor(state, "fall:steps", () => {
    const map = fieldOf(state),
      steps = new Set<number>();
    for (const { cells } of riversOf(state))
      for (const cell of cells)
        if (map.mesh.membership(cell) === 1 && isRiverStep(map, cell)) steps.add(cell);
    return [...steps].sort((a, b) => riverDrop(map, b) - riverDrop(map, a) || a - b);
  });
const among = (
  state: GenerationState,
  claimed: Claimed,
  passes: (cell: number, target: number) => boolean
) =>
  spacedAmong(state, claimed, stepsOf(state), fallsApart * cellSpan(state), (cell) =>
    passes(cell, flowTarget(state, cell))
  );

/** A fall the coarser map named stays one: where it stands on its river, which holds the step. */
function carried(state: GenerationState) {
  if (!("regional" in state)) return [];
  return carriedPlaces(state as RegionalState)
    .filter(({ entry }) => entry.id === "waterfall")
    .map(({ carried: place }) => hostedCell(state, place.feature))
    .filter((cell) => cell >= 0)
    .map((anchor) => ({ anchor }));
}
/** So tall a fall is known whatever made it. */
const great = (state: GenerationState, claimed: Claimed) => {
  const bar = mapScale(state).length(greatHeight, 0.5);
  return among(state, claimed, (cell) => sizeAtCell(state, cell).height >= bar);
};
/** Hard rock over softer: what lies below wears back and leaves a ledge. */
const ledge = (state: GenerationState, claimed: Claimed) => {
  const rock = groundOf(fieldOf(state));
  return among(
    state,
    claimed,
    (cell, target) =>
      target >= 0 &&
      rock.fold(cell, surfaceResistance) - rock.fold(target, surfaceResistance) >= ledgeContrast
  );
};
/** A river crossing ground that has moved: the scarp is the step. */
const fault = (state: GenerationState, claimed: Claimed) =>
  among(state, claimed, (cell) => fractureAt(state, cell) >= faulted);
/** A tributary left high above the greater river's deeper valley. */
const hanging = (state: GenerationState, claimed: Claimed) =>
  among(
    state,
    claimed,
    (cell, target) =>
      target >= 0 && dischargeAt(state, target) >= hangingShare * dischargeAt(state, cell)
  );
/** A river going straight over a cliff into the sea or a lake. */
const shore = (state: GenerationState, claimed: Claimed) =>
  among(
    state,
    claimed,
    (_cell, target) => target >= 0 && (isSea(state, target) || isLake(state, target))
  );
/** Boats must be carried round it, and the town that does the carrying names it. */
function portage(state: GenerationState, claimed: Claimed) {
  const steps = new Set(stepsOf(state)),
    taken = new Set<number>(),
    span = cellSpan(state);
  for (const town of settlementPlaces(state)) {
    if (town.anchor < 0 || hashUnit(salt, town.anchor, 0) >= portageChance) continue;
    for (const cell of cellsWithin(state, town.anchor, portageSpans * span))
      if (steps.has(cell) && !claimed.has(cell)) {
        taken.add(cell);
        break;
      }
  }
  return [...taken].map((anchor) => ({ anchor }));
}

/** Why a step in a river is a fall, in order of claim. Without a reason it stays steep water. */
const reasons: readonly PoiOrigin[] = [
  {
    id: "carried",
    statement: "A fall the coarser map named, at its place on its river.",
    reads: [],
    finds: carried,
  },
  {
    id: "great",
    statement: "A drop so tall it needs no other reason.",
    reads: [],
    finds: great,
  },
  {
    id: "ledge",
    statement: "Hard rock over softer, which wore back.",
    reads: [],
    finds: ledge,
  },
  {
    id: "fault",
    statement: "A river crossing ground that has moved.",
    reads: [],
    finds: fault,
  },
  {
    id: "hanging",
    statement: "A tributary left above the greater river's deeper valley.",
    reads: [],
    finds: hanging,
  },
  {
    id: "shore",
    statement: "A river going over a cliff into standing water.",
    reads: [],
    finds: shore,
  },
  {
    id: "portage",
    statement: "A step boats must be carried round, named by the town that carries them.",
    reads: ["settlement"],
    finds: portage,
  },
];
/** Each fall is found on a river, so it records that river as it is placed. */
export const waterfallOrigins: readonly PoiOrigin[] = reasons.map((reason) => ({
  ...reason,
  finds: (state, claimed) =>
    reason.finds(state, claimed).map((found) => ({
      ...found,
      hostedBy: linkOn(state, "river", found.anchor) ?? undefined,
    })),
}));
