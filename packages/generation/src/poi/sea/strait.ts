// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { siteRecord } from "../poiRecords";
import { cellSpan, cellsWithin, fieldOf, isSea } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { areaOf, depthAt, extentOf, faunaAt, heldUnder, near } from "./seaShared";
import { showsForm, wrapOf } from "./shoreForm";

/** Area at which a strait is half as great as straits get: 500 square kilometres. */
const typicalArea = 5e8;
/** A current this strong (per-mille) scours the bed instead of leaving it to silt. */
const scouringCurrent = 300;
/** A sill shallower than this, in metres, has closed the passage to the sea. */
const closedDepth = 2;
/** The least water a strait with a running current, or a refined one, keeps over its sill, in metres. */
const heldDepth = 2;
/** Extra boat cost at the full race of the narrows. */
const race = 1.5;
/** Roads run to a crossing; current-borne magic runs through it. */
const landingRoad = 0.85,
  funnelledCurrent = 0.7;

const isA = showsForm("strait");
const places = regionPlaces("strait", isA, wrapOf);
/** The country around a strait that bears on it: 40 km. */
const around = near(40_000);
const currentAt = (state: GenerationState, cell: number) =>
  fieldOf(state).OceanCurrentStrength.get(cell);
const reachOf = (state: GenerationState, place: PoiPlace) =>
  Math.max(2 * cellSpan(state), extentOf(state, place));
const counterpart = counterpartOf(isA, 2);

const factors = {
  magnitude: sized(areaOf, typicalArea),
  /** How narrow it stands against the water around it. */
  localConditions: standsOut(wrapOf, (state, place) =>
    Math.max(around(state), 2 * extentOf(state, place))
  ),
  /** The one way through a long coast matters more than one channel of an archipelago. */
  isolation: aloneAmong(places, (state) => 4 * around(state)),
  cultural: attachment((state) => 2 * around(state)),
};

/** A strong current scours the bed, so the passage holds its depth; a weak one can silt shut. */
const scoured = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] =>
  heldUnder(
    state,
    place.cells.filter((cell) => currentAt(state, cell) >= scouringCurrent),
    heldDepth
  );
const shallowest = (state: GenerationState, place: PoiPlace) =>
  place.cells.reduce((least, cell) => Math.min(least, depthAt(state, cell)), Infinity);

export const strait: PoiEntry = {
  id: "strait",
  group: "sea",
  name: "Strait",
  recognition: {
    distinct:
      "A sea cell that, on the smallest circle, of radius 1.5 to 800 km, that the map resolves and that shows any coastal form, has two shores of at least two samples whose middles stand at least 120 degrees apart, at least two gaps of water open straight from the cell, and ground over at least half the circle: water passing between two lands. A bay shows one arc of shore and one opening; water seen beyond a thin cape is not a gap, because the cape stands in the way; a fjord is excluded by its landform, because ice cut it.",
    isA,
  },
  existence: {
    statement:
      "Emerges wherever two coasts come close with water through: an island off a mainland, a rifted margin, a drowned valley or a sea rising over a low neck. The generator's marine regions separate seas at the same narrows, and its boats connect the two shores. Nothing places one.",
    way: "emerges",
    requires: notApplicable("Its test reads the water mask; nothing must stand there first."),
    suitability: notApplicable("No process chooses where two coasts come together."),
    places,
  },
  publication: {
    statement: "Every strait publishes as a site at its narrowest cell.",
    moment: "geography",
    record: siteRecord({
      kind: "strait",
      layer: "geology",
      name: "Strait",
      attributes: (state, place) => ({ wrap: wrapOf(state, place.anchor) }),
    }),
  },
  fields: {
    statement:
      "A strait holds its own channel open: where the water runs hard the bed cannot silt. The current itself, and the sea's heat and salt moving through, are the current process's.",
    terrain: scoured,
    water: notApplicable("The ocean current process writes current strength over the whole sea."),
    climate: notApplicable(
      "Its heat exchange is the current's own: the current process carries OceanCurrentHeat through it, and no air effect is resolved at this width."
    ),
    cover: notApplicable(
      "It is open salt water with no canopy; its fish follow the fauna process reading productivity."
    ),
    magic: notApplicable(
      "A strait holds no magic of its own; rays pass through as far as their straight paths allow, and its effect on carried magic is the movement cost."
    ),
  },
  acrossMaps: {
    statement:
      "A captured strait must stay a passage on the refined map: shelter filling could otherwise close it with a bar, so the bed within half a parent cell of it stays under water. It stands at the nearest narrows the finer coast develops, and keeps its place if the finer water reads as broad.",
    carry: carryWhereItLands,
    realize: (state, carried) =>
      heldUnder(
        state,
        cellsWithin(state, carried.cell, state.regional.parentSpan / 2).filter((cell) =>
          isSea(state, cell)
        ),
        heldDepth
      ),
    counterpart,
    unrealized: movesTo(counterpart),
    settle: notApplicable("Its bed is held under water, so a round's water does not move it."),
    schedule: notApplicable("Holding its bed under water is all a strait does to a refinement."),
  },
  movement: {
    statement:
      "A strait is the short way between two seas at the cost of its race, and the place where a road may cross by ferry; roads run towards it from both shores. A cost cannot open water to a road, so the crossing itself is declared in what it crosses.",
    roads: (state, place) =>
      cellsWithin(state, place.anchor, reachOf(state, place))
        .filter((cell) => !isSea(state, cell))
        .map((cell) => ({ cell, factor: landingRoad })),
    boats: (state, place) =>
      place.cells.map((cell) => ({ cell, factor: 1 + (race * currentAt(state, cell)) / 1000 })),
    drainage: notApplicable("Rivers end at the sea; each shore drains on its own side of it."),
    magic: { current: costNear(funnelledCurrent) },
    links: notApplicable("A crossing is declared in what it crosses; it joins no two fixed cells."),
    crosses: () => ["strait"],
  },
  others: {
    statement:
      "A strait has a shore on each side and harbours facing each other across it. It cannot be a bay, and a settlement that holds it gains its tolls and its name.",
    needs: notApplicable("Its test already requires both shores."),
    excludes: [
      { kind: "bay", holds: (_state, a, b) => b.cells.includes(a.anchor) },
      { kind: "fjord", holds: (_state, a, b) => b.cells.includes(a.anchor) },
    ],
    contains: notApplicable("Nothing stands in the running water of a passage."),
    pairsWith: [
      { kind: "harbour", holds: within(around) },
      { kind: "settlement", holds: within(around) },
      { kind: "headland", holds: within(around) },
    ],
  },
  people: {
    statement:
      "A strait is a choke point: whoever holds it taxes the traffic and bars fleets, and fish run through it. The race drowns those who misjudge it.",
    offers(state, place) {
      const narrow = wrapOf(state, place.anchor);
      return { trade: narrow, defence: narrow, food: faunaAt(state, place.anchor) };
    },
    threatens: (state, place) => [
      {
        hazard: "tide race",
        reach: reachOf(state, place),
        severity: currentAt(state, place.anchor) / 1000,
      },
    ],
  },
  time: {
    statement:
      "Sea-level fall, uplift or a slack current's silt can raise its sill until the passage closes, and the two seas part. A rise reopens it as a new place. Water that runs hard holds it open across epochs.",
    fate: (state, place) =>
      shallowest(state, place) < closedDepth ? { fate: "ends" } : { fate: "persists" },
  },
  visibility: {
    statement:
      "A strait shows by how alone it stands as the way through and how narrow it is against its waters, rather than by its size. A small lone passage between large seas outranks a wide channel among islands, and a town at its narrows carries it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.3, localConditions: 0.3, isolation: 0.4 }),
  },
  naming: {
    statement: "Named by whichever people hold or use it, often after the town at its narrows.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "settlement", holds: within(around) }],
    lendsNameTo: [{ kind: "harbour", holds: within(around) }],
  },
};
