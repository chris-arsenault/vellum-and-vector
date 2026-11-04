import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { namingCultureNear, regionPlaces, within } from "../poiPlaces";
import {
  adjacent,
  iceAt,
  isLand,
  landformAt,
  Landform,
  magicRule,
  magicValue,
  toNative,
} from "../poiReads";
import { aloneAmong, attachment, drawnWhen, standsOut } from "../poiVisibilityRules";
import { areaOf, flowTarget, spans } from "./waterReads";

/** Native millimetres a year of meltwater the band reads along a line; its most is 1000. */
const lineMelt = 600;
/** Metres of outwash its water lays on the ground below it. */
const outwash = 1;
/** Cover its fen holds beside the ice, the cover a wetland is read at. */
const fenCover = 0.3;
/** Temperature band of the rule's seeds and ice band of its retention, for the realized line. */
const lineWarmth = 330,
  lineIce = 200;

const isA = magicRule("aurora", "melt");
const chargeAt = (state: GenerationState, cell: number) =>
  magicValue(state, "aurora", "intensity", cell);
const places = regionPlaces("meltLine", isA, chargeAt);
const around = spans(6);
const counterpart = counterpartOf(isA, 1);
/** Half its weight is the charge it runs at; the rest grows with its length of ice edge. */
const greatness = (state: GenerationState, place: PoiPlace) =>
  (Math.min(1, chargeAt(state, place.anchor) / 1000) +
    areaOf(state, place) / (areaOf(state, place) + 1e8)) /
  2;
const factors = {
  magnitude: greatness,
  localConditions: standsOut(chargeAt, around),
  isolation: aloneAmong(places, around),
  cultural: attachment(around),
};
/** Bare ground beside a line's ice, where its water comes out. */
function iceEdge(state: GenerationState, place: PoiPlace) {
  const edge = new Set<number>();
  for (const cell of place.cells)
    for (const next of adjacent(state, cell))
      if (isLand(state, next) && iceAt(state, next) <= 0) edge.add(next);
  return [...edge];
}
/** Its water lays outwash on the ground the ice drains to. */
const outwashBelow = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] =>
  place.cells
    .map((cell) => flowTarget(state, cell))
    .filter((target) => target >= 0 && isLand(state, target))
    .map((cell) => ({
      change: "atLeast",
      band: "SedimentThickness",
      cell,
      value: toNative(outwash),
    }));
/** A line of steady melt: more than the ice's ablation alone gives in that cold. */
const meltOut = (_state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] =>
  place.cells.map((cell) => ({
    change: "atLeast",
    band: "GlacialMeltwater",
    cell,
    value: lineMelt,
  }));
/** The melt-line fen: wet, newly fed ground along the thaw. */
const fen = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] =>
  iceEdge(state, place).map((cell) => ({
    change: "atLeast",
    band: "WetlandCover",
    cell,
    value: fenCover,
  }));

export const meltLine: PoiEntry = {
  id: "meltLine",
  group: "water",
  name: "Melt line",
  recognition: {
    distinct:
      "A cell in Aurora's melt rule: Aurora intensity of at least 650 on ice 80 to 360 m thick at -2.5 to 8 degrees (Temperature native 275 to 380), retained a little wider. Thick charged ice in the cold is an aurora field; a light well needs a hollow landform; a frost prism stands on a ridge or peak. An ordinary glacier's edge has GlacialMeltwater but no charge, so it is no melt line and nothing in this kind reads it, and moraine is what ice has dropped, not ice still melting.",
    isA,
  },
  existence: {
    statement:
      "Emerges where Aurora's charged ice meets a thaw it cannot hold back. It exists only in a magic world with Aurora's ice; the same thaw on uncharged ice makes meltwater and no place.",
    way: "emerges",
    requires: notApplicable("Aurora's rule reads the charge, ice and warmth itself."),
    suitability: notApplicable("The thaw and the charge decide it; no process chooses a site."),
    places,
  },
  fields: {
    statement:
      "A melt line is a source that feeds the rivers below it through a steady thaw: it lays outwash, gives meltwater well above ablation alone, and leaves a fen of nutrient-rich ground. Stored charge leaves in the same water, so the thaw itself carries Aurora away.",
    terrain: outwashBelow,
    water: meltOut,
    climate: notApplicable(
      "The cold it exhales is Aurora's own heat effect, already applied in Temperature wherever the charge stands."
    ),
    cover: fen,
    magic: notApplicable(
      "`carryWithIce` loses charge to meltwater by the GlacialMeltwater band, so the water above already drains Aurora; nothing further is declared."
    ),
  },
  acrossMaps: {
    statement:
      "A captured line lands on finer ice that must carry its thaw: enough ice and warmth at the cell for the rule to read there, and meltwater running from it. Each round it shifts to the nearest line the settled ice shows; with none near it goes, having thawed or frozen on closer ground.",
    carry: carryWhereItLands,
    realize: (_state, carried): readonly PoiFieldChange[] => [
      { change: "atLeast", band: "GlacialMeltwater", cell: carried.cell, value: lineMelt },
      { change: "atLeast", band: "IceThickness", cell: carried.cell, value: lineIce },
      { change: "atLeast", band: "Temperature", cell: carried.cell, value: lineWarmth },
    ],
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: movesTo(counterpart),
  },
  movement: {
    statement:
      "Rotten ice and slush are the worst going on a glacier's way across; the network begins from the line's water; charge riding the ice leaves it here, so a carrier's way along the ice grows dearer.",
    roads: costNear(2),
    boats: notApplicable("Meltwater here is under and over ice, with no reach a boat could use."),
    drainage: costNear(0.8),
    magic: costNear(1.5),
    crosses: notApplicable("Rotten ice is where a route across ice is lost, not where it is won."),
  },
  others: {
    statement:
      "A line stands within an aurora field's ice and at its edge; wetlands gather below it, moraine lies where it has passed, and frost prisms and light wells hold the colder parts of the same ice.",
    needs: [{ kind: "auroraField", holds: within(around) }],
    excludes: [{ kind: "thawedHalo", holds: (_state, a, b) => a.cells.includes(b.anchor) }],
    contains: notApplicable("A line is a band of thawing ice and holds no place of its own."),
    pairsWith: [
      { kind: "wetland", holds: within(spans(3)) },
      { kind: "moraine", holds: within(around) },
      { kind: "frostPrism", holds: within(around) },
    ],
  },
  people: {
    statement:
      "A melt line gives clean water through the warm season and rich fen where it goes, and what came out of the ice can be gathered; the ice can release its water in one burst.",
    offers(state, place) {
      const great = greatness(state, place);
      return { water: great, food: great / 2, materials: great / 2, sanctity: great / 3 };
    },
    threatens: (state, place) => [
      {
        hazard: "ice-dammed outburst",
        reach: 2 * around(state),
        severity: greatness(state, place),
      },
    ],
  },
  time: {
    statement:
      "A line moves with the thaw across epochs. Where the ice thickens again it is an aurora field; where it has melted away it ends, leaving moraine if the ice dropped any.",
    fate(state, place) {
      if (isA(state, place.anchor)) return { fate: "persists" };
      if (magicRule("aurora", "field")(state, place.anchor))
        return { fate: "becomes", kind: "auroraField" };
      return landformAt(state, place.anchor) === Landform.Moraine
        ? { fate: "ends", leaves: "moraine" }
        : { fate: "ends" };
    },
  },
  visibility: {
    statement:
      "A line shows by the charge it runs at and the length it holds along the ice; lines are extended and cluster along one ice front, so isolation counts little.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.5, localConditions: 0.4, isolation: 0.1 }),
  },
  naming: {
    statement:
      "Named by the people nearest who live on its water; with no one on the map it goes unnamed.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("It is named for what it does, and nothing near it is older."),
    lendsNameTo: [{ kind: "wetland", holds: within(spans(3)) }],
  },
};
