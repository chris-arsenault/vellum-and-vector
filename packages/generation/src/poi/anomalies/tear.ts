import { units } from "../../canonry/math";
import { hashUnit } from "../../canonry/noise";
import type { GenerationState } from "../../process";
import { carryWhereItLands, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { cellSpan, fieldOf, isLand, magicRule } from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import { magicFieldOf, peakOf, standsIn } from "./anomalyReads";

/** Tearing at which a tear is half as great as tears get. */
const typicalTearing = 0.5;
/** Wildness at which a tear is on the way to being a wild zone: half the wild rule's own floor. */
const turningWild = 0.15;
/** Verdure at which living ground has knit a tear shut. */
const knitShut = 0.5;
/** The fixed per-cell hash the regional wild writes use, so a shift does not ratchet. */
const wildHash = 0x7e11;

const isTear = magicRule("veil", "tear"),
  isWild = magicRule("veil", "wild");
const isA = (state: GenerationState, cell: number) => isTear(state, cell) && !isWild(state, cell);
const tearingAt = (state: GenerationState, cell: number) => fieldOf(state).Tearing.get(cell);
const places = regionPlaces("tear", isA, tearingAt);
const around = (state: GenerationState) => 4 * cellSpan(state);
const veil = (state: GenerationState) => magicFieldOf(state, "veil");
const wildAt = (state: GenerationState, cell: number) => veil(state)?.wild.get(cell) ?? 0;
const peakTearing = (state: GenerationState, place: PoiPlace) => peakOf(state, place, tearingAt);
const counterpart = counterpartOf(isA, 1);
const factors = {
  magnitude: sized(peakTearing, typicalTearing),
  localConditions: standsOut(tearingAt, around),
  isolation: aloneAmong(places, (state) => 2 * around(state)),
  cultural: attachment(around),
};
/** The signed draw of a cell's shift, from the hash the regional writes hold. */
const drawAt = (cell: number) => hashUnit(wildHash, cell, 0) - 0.5;
/** The small unsettled share of a stable tear shifts its ground by the wild relief. */
const shifting = (state: GenerationState, place: PoiPlace): PoiFieldChange[] => {
  const relief = veil(state)?.definition.parameters.wildRelief ?? 0;
  return place.cells
    .filter((cell) => wildAt(state, cell) > 0 && isLand(state, cell))
    .map((cell) => ({
      change: "add",
      band: "Elevation",
      cell,
      amount: units(relief * wildAt(state, cell) * 2 * drawAt(cell)),
    }));
};
/** The same share trades cover at the tear's edge: grass to wood on one draw, wood to grass on the other. */
function coverShift(state: GenerationState, cell: number): PoiFieldChange[] {
  const map = fieldOf(state),
    share = (veil(state)?.definition.parameters.wildShuffle ?? 0) * wildAt(state, cell);
  if (drawAt(cell) > 0) {
    const moved = map.GrassCover.get(cell) * share;
    return [
      { change: "add", band: "GrassCover", cell, amount: -moved },
      { change: "add", band: "BroadleafCover", cell, amount: moved },
      { change: "add", band: "TreeCover", cell, amount: moved },
    ];
  }
  const broadleaf = map.BroadleafCover.get(cell),
    conifer = map.ConiferCover.get(cell),
    moved = (broadleaf + conifer) * share;
  return [
    { change: "add", band: "BroadleafCover", cell, amount: -broadleaf * share },
    { change: "add", band: "ConiferCover", cell, amount: -conifer * share },
    { change: "add", band: "TreeCover", cell, amount: -moved },
    { change: "add", band: "GrassCover", cell, amount: moved },
  ];
}
const tearingHere = (state: GenerationState, place: PoiPlace, cell: number) =>
  place.cells.includes(cell) ? tearingAt(state, cell) : 0;

export const tear: PoiEntry = {
  id: "tear",
  group: "anomalies",
  name: "Tear",
  recognition: {
    distinct:
      "A cell of Veil's tear rule that is not also under its wild rule: tear intensity past the rule's level, on land or a lake, with the wildness below the wild rule's floor. It is strain that holds still. A wild zone is the share of a tear that moved since the last epoch; a door is a tear's cell that was paired with a distant one, and stands inside a tear as a contained place.",
    isA,
  },
  existence: {
    statement:
      "Emerges where two other systems both run strong and their difference turns sharply across a cell, or where a meeting holds the ground. Nothing is stored: a tear is what the strain is now, relaxed by living ground and held open by salt.",
    way: "emerges",
    requires: (state, cell) => (veil(state)?.originSources.tear?.get(cell) ?? 0) > 0,
    suitability: notApplicable("The fronts between systems place it; nothing chooses a site."),
    places,
  },
  fields: {
    statement:
      "A tear holds the Tearing band up, and the little of it that is not yet stable moves ground and cover without any cause on the map: streams shift, and a forest edge walks. It stores no water and no heat.",
    terrain: shifting,
    water: notApplicable(
      "A stable tear neither holds nor sheds water; a stream's shift comes through its terrain."
    ),
    climate: notApplicable("Strain carries no heat; the chill belongs to a door's cold pool."),
    cover: (state, place) =>
      place.cells
        .filter((cell) => wildAt(state, cell) > 0 && isLand(state, cell))
        .flatMap((cell) => coverShift(state, cell)),
    magic: (state, place) =>
      place.cells.map((cell) => ({
        change: "atLeast",
        band: "Tearing",
        cell,
        value: tearingAt(state, cell),
      })),
  },
  acrossMaps: {
    statement:
      "A tear does not carry down as ground to be shaped: regional magic re-derives the strain from the refined fields, so a captured tear is the nearest cell that tears again. If finer fronts relax below the floor there, it goes. Each round's new fields can shift it.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "Strain comes from the other systems' refined fields; no ground can be prepared for it."
    ),
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: movesTo(counterpart),
  },
  movement: {
    statement:
      "Routes go around an unhoused tear in proportion to how torn it is: forcing it worsens it and is held lethal. Streams and boats meet the same unreliable ground, and what systems carry through a tear loses its way. It opens no way anywhere until it pairs into a door.",
    roads: (state, place, cell) => 1 + 2 * tearingHere(state, place, cell),
    boats: (state, place, cell) => 1 + 2 * tearingHere(state, place, cell),
    drainage: (state, place, cell) => (place.cells.includes(cell) ? 1 + wildAt(state, cell) : 1),
    magic: (state, place, cell) => 1 + tearingHere(state, place, cell),
    crosses: notApplicable("An unpaired tear leads nowhere; only a door crosses a barrier."),
  },
  others: {
    statement:
      "A tear may hold a door and may fray into a wild zone; it is never one, by its own test. Salt ground beneath holds it open, and a door-keeper's town grows from one.",
    needs: notApplicable(
      "It reads strain between fields, which a system's reach supplies with or without any place."
    ),
    excludes: [{ kind: "wildZone", holds }],
    contains: [{ kind: "door", holds }],
    pairsWith: [
      { kind: "wildZone", holds: within(around) },
      { kind: "saltPan", holds: standsIn },
    ],
  },
  people: {
    statement:
      "Keepers can house a tear and revere it, and a strong one may yet pair into a door. Forcing it kills, and land near it can't be trusted to stay as surveyed.",
    offers: (state, place) => ({ sanctity: peakTearing(state, place) / 2 }),
    threatens: (state, place) => [
      {
        hazard: "forced crossing and shifting ground",
        reach: 2 * cellSpan(state),
        severity: peakTearing(state, place),
      },
    ],
  },
  time: {
    statement:
      "A tear keeps nothing between epochs and stands only while the strain does. Greenwood's living ground knits it shut and leaves nothing; a tear whose strength shifts between epochs frays into a wild zone.",
    fate(state, place) {
      if (fieldOf(state).Verdure.get(place.anchor) >= knitShut) return { fate: "ends" };
      return wildAt(state, place.anchor) >= turningWild
        ? { fate: "becomes", kind: "wildZone" }
        : { fate: "persists" };
    },
  },
  visibility: {
    statement:
      "A tear shows by how fully the ground is torn and how sharply that stands out of its country; a tear far from any other rates above one on a long front, and a keeper's town carries a faint one.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.45, localConditions: 0.35, isolation: 0.2 }),
  },
  naming: {
    statement:
      "Named by those who fear it or keep it, after the town or ruin nearest it; the door within it often takes the same name.",
    namedBy: namingCultureNear,
    takesNameFrom: [
      { kind: "settlement", holds: within(around) },
      { kind: "ruin", holds: within(around) },
    ],
    lendsNameTo: [{ kind: "door", holds }],
  },
};
