// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import type { GenerationState } from "../../process";
import { carryWhereItLands, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, rulePlaces, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { fieldOf, magicRule } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { countryOf, magicFieldOf, peakOf, standsIn } from "./anomalyReads";

/** Tearing at which a tear is half as great as tears get. */
const typicalTearing = 0.5;
/** Wildness at which a tear is on the way to being a wild zone: half the wild rule's own floor. */
const turningWild = 0.15;
/** Verdure at which living ground has knit a tear shut. */
const knitShut = 0.5;
/** A tear's country, and how far off a forced crossing or shifting ground reaches, in metres. */
const countryMetres = 4000,
  hazardMetres = 2000;

const isA = magicRule("veil", "tear");
const tearingAt = (state: GenerationState, cell: number) => fieldOf(state).Tearing.get(cell);
const places = rulePlaces("tear", "veil", "tear");
const around = countryOf(countryMetres);
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
/** A network's cost through a tear's cells: dearer the more torn each is. */
const dearerBy = (weight: number) => (state: GenerationState, place: PoiPlace) =>
  place.cells.map((cell) => ({ cell, factor: 1 + weight * tearingAt(state, cell) }));
const losesItsWay = dearerBy(1);

export const tear: PoiEntry = {
  id: "tear",
  group: "anomalies",
  name: "Tear",
  recognition: {
    distinct:
      "A cell of Veil's tear rule: tear intensity past the rule's level, on land or a lake. A wild zone is the share of a tear that moved since the last epoch and may lie over it; a door is a tear's cell that was paired with a distant one, and stands inside a tear as a contained place.",
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
  publication: {
    statement: "Every connected tear publishes as Veil's tear class, outlined by its coverage.",
    moment: "magic",
    record: ruleRecord("veil", "tear"),
  },
  fields: {
    statement:
      "A tear does nothing to a medium as a place: the moved share of Veil's field shifts ground and cover wherever it stands, and Tearing is that field's own reading. It stores no water and no heat.",
    terrain: notApplicable(
      "`veilWrites` and `declareWildRelief` move the ground by wildness across Veil's whole field."
    ),
    water: notApplicable(
      "A tear neither holds nor sheds water; a stream's shift comes through the moved ground."
    ),
    climate: notApplicable("Strain carries no heat; the chill belongs to a door's cold pool."),
    cover: notApplicable("`veilWrites` trades cover by wildness across Veil's whole field."),
    magic: notApplicable("`magicLivingFeedback` writes Tearing from Veil's field."),
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
    schedule: notApplicable("Its strain is re-derived with the rest of Veil's field each round."),
  },
  movement: {
    statement:
      "Routes go around an unhoused tear in proportion to how torn it is: forcing it worsens it and is held lethal. Streams and boats meet the same unreliable ground, and what systems carry through a tear loses its way. It opens no way anywhere until it pairs into a door.",
    roads: dearerBy(2),
    boats: dearerBy(2),
    drainage: (state, place) =>
      place.cells.map((cell) => ({ cell, factor: 1 + wildAt(state, cell) })),
    magic: {
      crust: losesItsWay,
      river: losesItsWay,
      wind: losesItsWay,
      ice: losesItsWay,
      people: losesItsWay,
    },
    links: notApplicable("An unpaired tear joins nothing; its pair is a door."),
    crosses: notApplicable("An unpaired tear leads nowhere; only a door crosses a barrier."),
  },
  others: {
    statement:
      "A tear may hold a door and may fray into a wild zone, which can lie over it. Salt ground beneath holds it open, and a door-keeper's town grows from one.",
    needs: notApplicable(
      "It reads strain between fields, which a system's reach supplies with or without any place."
    ),
    excludes: notApplicable(
      "A wild share and a door both stand on a tear; strain excludes neither."
    ),
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
        reach: hazardMetres,
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
    importance: weighed(factors, { magnitude: 0.45, localConditions: 0.35, isolation: 0.2 }),
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
