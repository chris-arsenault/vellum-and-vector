// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { areaRecord } from "../poiRecords";
import { cellSpan, isLand, landformAt, Landform, metres, slopeAt } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import {
  landmarkGround,
  lastsWhile,
  lengthOf,
  meanOf,
  ringHeights,
  sitingAdmits,
  sitingSuits,
  spans,
  standsIn,
} from "./reliefShape";

/** The face falls at least this many times faster than the ground above and below it. */
const stepRatio = 3;
/** The least gradient across the face that is a step rather than a long fall of the land. */
const steepestPlain = 0.02;
/** Throw and length at which a scarp is half as great as scarps get. */
const typicalThrow = 300,
  typicalLength = 100_000;

interface Step {
  /** Metres between the top of the face and its foot. */
  drop: number;
  gradient: number;
}
const noStep: Step = { drop: 0, gradient: 0 };
/** The profile down a cell's steepest line, one and two cells out either side. */
function stepOn(inner: number[], outer: number[], direction: number, span: number): Step {
  const opposite = (direction + 8) % 16,
    top = inner[opposite],
    foot = inner[direction],
    gradient = metres(top - foot) / (2 * span),
    above = metres(outer[opposite] - top) / span,
    below = metres(foot - outer[direction]) / span;
  if (!(gradient >= steepestPlain) || !(above >= 0) || !(below >= 0)) return noStep;
  return gradient >= stepRatio * Math.max(above, below)
    ? { drop: metres(top - foot), gradient }
    : noStep;
}
/** A face in the long profile: the steepest line that breaks sharply at its top and foot. */
function stepAt(state: GenerationState, cell: number): Step {
  const span = cellSpan(state),
    inner = ringHeights(state, cell, span),
    outer = ringHeights(state, cell, 2 * span);
  let best = noStep;
  for (let direction = 0; direction < 16; direction++) {
    const step = stepOn(inner, outer, direction, span);
    if (step.gradient > best.gradient) best = step;
  }
  return best;
}
const scarpWidth = (state: GenerationState, parameters: Record<string, number>) =>
  Math.max(parameters.scarpWidth * 1000, 1.2 * cellSpan(state));
const faulted = (state: GenerationState, cell: number) =>
  landmarkGround(state, "escarpment", (placed) => scarpWidth(state, placed.parameters)).has(cell);
const incised = (state: GenerationState, cell: number) => {
  const code = landformAt(state, cell);
  return code === Landform.Gorge || code === Landform.Waterfall;
};
const isA = (state: GenerationState, cell: number) =>
  isLand(state, cell) &&
  (faulted(state, cell) || (!incised(state, cell) && stepAt(state, cell).gradient > 0));
const throwAt = (state: GenerationState, cell: number) => stepAt(state, cell).drop;
const places = regionPlaces("escarpment", isA, throwAt);
const throwOf = (state: GenerationState, place: PoiPlace) => throwAt(state, place.anchor);
const counterpart = counterpartOf(isA, 1);
const factors = {
  magnitude: meanOf(sized(throwOf, typicalThrow), sized(lengthOf, typicalLength)),
  localConditions: standsOut(slopeAt, spans(6)),
  isolation: aloneAmong(places, spans(12)),
  cultural: attachment(spans(8)),
};
const outline = areaRecord({
  kind: "escarpment",
  layer: "geology",
  name: "Escarpment",
  attributes: (state, place) => ({ throw: throwOf(state, place) }),
});

export const escarpment: PoiEntry = {
  id: "escarpment",
  group: "relief",
  name: "Escarpment",
  recognition: {
    distinct:
      "A land cell on the drawn fault of an escarpment record, or on a face: down its steepest line the gradient is at least 0.02 and three times what it is on the ground above and below, with the land falling one way throughout. It falls on one side only, where a ridge falls on both; its break at top and foot is what a long slope lacks; and the low side keeps falling or stays level, where a gorge wall rises again across the floor.",
    isA,
  },
  existence: {
    statement:
      "Both: a fault the generator sites where the land already has a long fall, offsetting its two sides by a throw it then maintains; and a face that emerges at a plateau's edge, a rift margin or a cut-back coast. They are one physical thing; the record is a property the face may have, and a rift edge is the same kind with a graben below it.",
    way: "both",
    requires: sitingAdmits("escarpment"),
    suitability: sitingSuits("escarpment"),
    places,
  },
  publication: {
    statement:
      "A face publishes as its outline with its throw. A fault on an escarpment record publishes as that record, once.",
    moment: "geography",
    record: (state, place) => (faulted(state, place.anchor) ? null : outline(state, place)),
  },
  fields: {
    statement:
      "An escarpment is a step in the ground and, where it is a fault, an open trunk of the fracture set along it, which rising heat and magic follow.",
    terrain: notApplicable(
      "Tectonics and erosion leave a face; a record's landmark cause maintains its throw."
    ),
    water: notApplicable(
      "Rivers fall over it through their own gradient; a fall on it is the waterfall entry."
    ),
    climate: notApplicable(
      "Its rain on the high side comes from the air columns reading the step along the wind."
    ),
    cover: notApplicable("Cover thins on the face through the slope limits ecology already reads."),
    magic: notApplicable("The fault's emplacement and refinement's fault opening write the trunk."),
  },
  acrossMaps: {
    statement:
      "A captured scarp lands on the refined map: a fault record is re-placed and its throw maintained by its own landmark cause, which also opens the fracture trunk; an emergent face takes the nearest face the finer relief develops.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "A record's landmark cause writes its throw; an emergent face is read from the developed relief."
    ),
    counterpart,
    unrealized: movesTo(counterpart),
    settle: notApplicable("A face retreats over epochs, not with a round's water."),
    schedule: notApplicable("A fault record's steps belong to its landmark cause."),
  },
  movement: {
    statement:
      "A scarp is dear to climb and impassable to carts away from its gaps; a river meeting it falls over it, and the fault along it conducts what crust carries.",
    roads: notApplicable("The ruling-grade cost already reads its face."),
    boats: notApplicable("A boat meets only the fall a river makes on it, which is its own entry."),
    drainage: costNear(0.8),
    magic: notApplicable("Crust-borne magic spreads by the conductance along the fault."),
    links: notApplicable("A scarp joins nothing."),
    crosses: notApplicable("It is a barrier; a pass or a gorge cut through it is the way across."),
  },
  others: {
    statement:
      "A scarp bounds a plateau above it, sheds falls and springs at its foot, and is broken by the gorges that cut back into it. It cannot lie in a lake.",
    needs: notApplicable("A face needs only the ground on each side, which its test reads."),
    excludes: [{ kind: "lake", holds: standsIn }],
    contains: notApplicable("Falls and springs on it are recognized by their own water."),
    pairsWith: [
      { kind: "plateau", holds: within(spans(4)) },
      { kind: "waterfall", holds: within(spans(4)) },
      { kind: "gorge", holds: within(spans(6)) },
      { kind: "spring", holds: within(spans(4)) },
    ],
  },
  people: {
    statement:
      "A scarp walls off a country, exposes every layer of its rock to quarry and mine, and sheds rock on those who build at its foot.",
    offers(state, place) {
      const size = sized(throwOf, typicalThrow)(state, place);
      return { defence: size, materials: size };
    },
    threatens: (state, place) => [
      {
        hazard: "rockfall",
        reach: cellSpan(state),
        severity: sized(throwOf, typicalThrow)(state, place) / 2,
      },
    ],
  },
  time: {
    statement:
      "A face retreats from its top and keeps its height while its caprock lasts; when the slopes have graded the step it has ended, and a fault record's throw is held up regardless.",
    fate: lastsWhile(isA),
  },
  visibility: {
    statement:
      "A scarp shows by its throw and length together and by how sharply it breaks gentle land; a long low step over plains outranks a higher one among mountains.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.5, localConditions: 0.35, isolation: 0.15 }),
  },
  naming: {
    statement:
      "Named by the people below it, who see it; a record the generator sited is named once and keeps it.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("Scarps are named for themselves; nothing else lends to one."),
    lendsNameTo: [{ kind: "settlement", holds: within(spans(6)) }],
  },
};
