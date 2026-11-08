// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { exposure } from "../../world/magicStocks";
import { MapScale } from "@atlas/domain";
import { mapScale } from "../../worldSignificance";
import type { GenerationState } from "../../process";
import { cellAt } from "../../regional/lattice";
import { tappingReach } from "../../societyColdAge";
import { tappableFire } from "../../societyDemand";
import { carryWhereItLands, costNear, counterpartOf } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { holdsRecord, namingCultureNear, sitedPlaces, within } from "../poiPlaces";
import {
  cellsWithin,
  featureCell,
  fieldOf,
  gap,
  heldFor,
  isLake,
  isLand,
  isSea,
  magicRule,
  magicValue,
  rockAt,
  sedimentAt,
  settlementsOf,
  slopeAt,
  toNative,
} from "../poiReads";
import { siteRecord } from "../poiRecords";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import {
  aroundOf,
  capOf,
  effectOf,
  floorOf,
  fullSaltOf,
  movesOrGoes,
  panAt,
  parameterOf,
  placerAt,
  reservoirPerArea,
  stockPerArea,
  veinAt,
} from "./groundReads";

/** Fallen or spent ore per square metre at which a deposit is as rich as they get. */
const richOre = 1000;
/** Resistant rock under this depth of sediment can be cut for stone. */
const stoneRock = 0.5,
  stoneCover = 0.00000025;
/** Share of a plain deposit against an ore body: gravel, salt crust and stone, worth working but no prize. */
const gravelWorth = 0.4,
  stoneWorth = 0.3;
/** Steeper ground than this cannot be worked or reached. */
const steepestWorking = 0.3;
/** Workings stand at least this far apart, in metres: one district's pits count as one mine. */
// length-unit: fraction
const workingSpacing = 0.015;
/** Dose of work at which a mine is half as great as they get; a working with no record runs at it. */
const typicalDose = 0.5;
/** What a full dose of work takes from the ground: metres of pit, the fracture a tap opens. */
// length-unit: fraction
const pitDepth = 0.0000025,
  tapOpening = 250;
/** Tailings' toxicity at full dose in the next cell down the drainage. */
const tailings = 0.5;
/** A haul track's cost near the works, and how far it wears the ground, in metres. */
const haulGoing = 0.7,
  haulReach = MapScale.length(0.00125);
/** A tap's cost to Fire through the rock it opened; a quarry sends charge out with its people. */
const tappedCost = 0.7,
  quarriedCost = 0.85;
/** Dose below which works are abandoned; the bench a working stands on, rise over run. */
const abandoned = 0.1,
  benchGrade = 0.12;
/** Distance a collapse or burst reaches from the works, in metres. */
// length-unit: fraction
const collapseReach = 0.00025;

const worked = new Set(["tapping", "quarrying"]);
/** The world's located workings by place id; a World-profile demand has no site until realized. */
const workings = (state: GenerationState) =>
  heldFor(state, "mine:workings", () => {
    const found = new Map<string, { kind: string; dose: number; culture?: string; cell: number }>();
    if (!state.physical) return found;
    const mesh = fieldOf(state).mesh;
    for (const work of state.society?.region.works ?? []) {
      if (!worked.has(work.kind) || work.demand) continue;
      const cell = cellAt(mesh, work.position.x, work.position.y);
      if (cell < 0 || mesh.membership(cell) !== 1) continue;
      found.set(work.id, {
        kind: work.kind,
        dose: work.magnitude * work.condition,
        culture: work.naming?.culture,
        cell,
      });
    }
    return found;
  });

const prismRule = magicRule("aurora", "prism");
const tappable = (state: GenerationState, cell: number) =>
  veinAt(state, cell) || magicValue(state, "fire", "intensity", cell) >= tappableFire;
/** Ore a band can reach: Fire tappable in the rock, fallen metal, spent ore erosion has bared. */
function oreAt(state: GenerationState, cell: number) {
  const fallen = stockPerArea(state, "fire", "fallen/held", cell) / richOre,
    spent = stockPerArea(state, "fire", "vein/spent", cell) / richOre,
    bare = exposure(
      fieldOf(state),
      cell,
      parameterOf(state, "fire", "buryDepth") ?? mapScale(state).length(0.000005, 0.5)
    );
  return Math.max(
    tappable(state, cell) ? magicValue(state, "fire", "intensity", cell) / 1000 : 0,
    fallen,
    spent * bare
  );
}
/** Salt to cut: the bed Salt keeps, as a share of its full level; crust alone is a plain deposit. */
function saltAt(state: GenerationState, cell: number) {
  const bed = reservoirPerArea(state, "salt", "bed", cell) / fullSaltOf(state);
  return Math.max(bed, panAt(state, cell) ? gravelWorth : 0);
}
const stoneAt = (state: GenerationState, cell: number) =>
  rockAt(state, cell) >= stoneRock &&
  sedimentAt(state, cell) < mapScale(state).length(stoneCover, 0.5)
    ? stoneWorth * rockAt(state, cell)
    : 0;
/** How rich the deposit at a cell is, in [0, 1], the richest of what lies there; 0 for no deposit. */
const depositAt = (state: GenerationState, cell: number) =>
  Math.min(
    1,
    Math.max(
      oreAt(state, cell),
      prismRule(state, cell) ? 1 : 0,
      saltAt(state, cell),
      placerAt(state, cell) ? gravelWorth : 0,
      stoneAt(state, cell)
    )
  );

/** Every cell within a band's reach of a settlement. */
const peopled = (state: GenerationState) =>
  heldFor(state, "mine:peopled", () => {
    const cells = new Set<number>();
    for (const town of settlementsOf(state)) {
      const at = featureCell(state, town);
      if (at >= 0)
        for (const cell of cellsWithin(state, at, mapScale(state).resolveMeasure(tappingReach)))
          cells.add(cell);
    }
    return cells;
  });
const requires = (state: GenerationState, cell: number) =>
  isLand(state, cell) && peopled(state).has(cell) && depositAt(state, cell) > 0;
/** The richer the deposit and the easier the ground, the better; neither makes up for the other's lack. */
const suitability = (state: GenerationState, cell: number) =>
  Math.sqrt(depositAt(state, cell) * (1 - Math.min(1, slopeAt(state, cell) / steepestWorking)));
const sited = sitedPlaces("mine", requires, suitability, (state) =>
  mapScale(state).length(workingSpacing)
);
/** The world's own workings, and the best-suited ground no working stands near. */
const places = (state: GenerationState): readonly PoiPlace[] =>
  heldFor(state, "mine:places", () => {
    const recorded = [...workings(state)].map(([id, { cell }]): PoiPlace => ({
      id,
      kind: "mine",
      cells: [cell],
      anchor: cell,
    }));
    return [
      ...recorded,
      ...sited(state).filter((place) =>
        recorded.every(
          (work) => gap(state, place.anchor, work.anchor) >= mapScale(state).length(workingSpacing)
        )
      ),
    ];
  });
const isA = holdsRecord("mine", places);

const workOf = (state: GenerationState, place: PoiPlace) =>
  workings(state).get(place.id)?.kind ??
  (place.feature?.attributes.work as string | undefined) ??
  (tappable(state, place.anchor) ? "tapping" : "quarrying");
const doseOf = (state: GenerationState, place: PoiPlace) =>
  workings(state).get(place.id)?.dose ??
  (place.feature?.attributes.dose as number | undefined) ??
  typicalDose;
const onDryLand =
  (effect: (state: GenerationState, place: PoiPlace) => readonly PoiFieldChange[]) =>
  (state: GenerationState, place: PoiPlace) =>
    isLand(state, place.anchor) ? effect(state, place) : [];

const factors = {
  magnitude: sized(doseOf, typicalDose),
  localConditions: standsOut(depositAt, aroundOf),
  isolation: aloneAmong(places, (state) => 2 * aroundOf(state)),
  cultural: attachment((state) => 2 * aroundOf(state)),
};
const counterpart = counterpartOf(
  (state: GenerationState, cell: number) => depositAt(state, cell) > 0,
  1
);
/** What the work takes from the rock at its anchor: a tap cracks it wider, a quarry frees the prism's ice. */
const workOnRock = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] => {
  const cell = place.anchor,
    dose = doseOf(state, place);
  if (workOf(state, place) === "tapping")
    return [{ change: "add", band: "FractureConductance", cell, amount: tapOpening * dose }];
  if (!prismRule(state, cell)) return [];
  const held = effectOf(state, "aurora", "icePersistence");
  return [capOf("IcePersistence", cell, held * (1 - Math.min(1, dose)))];
};
const atAnchor = (work: string, factor: number) => (state: GenerationState, place: PoiPlace) =>
  workOf(state, place) === work ? [{ cell: place.anchor, factor }] : [];

export const mine: PoiEntry = {
  id: "mine",
  group: "ground",
  name: "Mine",
  recognition: {
    distinct:
      "A working cut into a deposit: a located society work of kind tapping or quarrying, or the ground people have sited one on. Mines and quarries are one kind; what they take, ore or prism or salt or stone, is read from the deposit under them and is a property. The working decides, not the rock: a thermal vein or placer with no work on it is a deposit, and a forge is the seat where ore is used, not the place it comes from.",
    isA,
  },
  existence: {
    statement:
      "Sited by people. A society's located tapping and quarrying works stand where the society placed them; beyond those, people work the best-suited deposit within a band's reach of a settlement, each working at least its spacing from the next.",
    way: "sited",
    requires,
    suitability,
    places,
  },
  publication: {
    statement:
      "Every working publishes as a site, with the work it does and the dose kept up there.",
    moment: "society",
    record: siteRecord({
      kind: "mine",
      layer: "landUse",
      name: "Mine",
      attributes: (state, place) => ({
        work: workOf(state, place),
        dose: doseOf(state, place),
      }),
    }),
  },
  fields: {
    statement:
      "A working takes from the ground by the dose of work kept up: a pit lowers it, tailings foul the water below it, the ground is stripped of trees, and each kind changes what its deposit does. A tap opens the fracture, so Fire reaches further; a quarry strips the charge, so the ice its prism held goes.",
    terrain: onDryLand((state, place) => [
      {
        change: "add",
        band: "Elevation",
        cell: place.anchor,
        amount: -toNative(mapScale(state).length(pitDepth, 0.5) * doseOf(state, place)),
      },
    ]),
    water(state, place) {
      const below = fieldOf(state).FlowTargets.get(place.anchor);
      return below < 0 || !isLand(state, below)
        ? []
        : [floorOf("EcologicalToxicity", below, Math.min(1, tailings * doseOf(state, place)))];
    },
    climate: notApplicable(
      "A pit's smoke and bare ground are below what the climate field resolves."
    ),
    cover: onDryLand((_state, place) => [
      capOf("TreeCover", place.anchor, 0),
      capOf("BroadleafCover", place.anchor, 0),
      capOf("ConiferCover", place.anchor, 0),
    ]),
    magic: onDryLand(workOnRock),
  },
  acrossMaps: {
    statement:
      "A captured mine lands where its work stands. It needs a level bench to stand on, and a deposit under it on the finer ground: if the deposit's cell is not at the landing, it moves to the nearest within a parent span, and with none it goes. A round's water that floods it moves it or ends it the same way.",
    carry: carryWhereItLands,
    realize: (_state, carried) => [
      { change: "gradeGround", cell: carried.cell, gradient: benchGrade },
    ],
    counterpart,
    unrealized: movesOrGoes(counterpart),
    settle: (state, carried) =>
      isLake(state, carried.cell) || isSea(state, carried.cell)
        ? movesOrGoes(counterpart)(state, carried)
        : { outcome: "keep" },
    schedule: notApplicable("A mine does nothing at refinement's other points."),
  },
  movement: {
    statement:
      "Haul tracks wear the ground around a working; a tap gives Fire an easier way through the rock it cracked and a quarry sends what it takes away with people. The ore leaves by road, and a pit opens no way through anything.",
    roads: costNear(haulGoing, haulReach),
    boats: notApplicable(
      "A working ships through a harbour or a river town, which are their own entries."
    ),
    drainage: notApplicable(
      "A pit is declared as lowered ground under terrain, and the network reads elevation for itself."
    ),
    magic: { crust: atAnchor("tapping", tappedCost), people: atAnchor("quarrying", quarriedCost) },
    links: notApplicable("A working joins no two cells for walkers."),
    crosses: notApplicable("Workings end under the ground; they are no through route."),
  },
  others: {
    statement:
      "A mine needs people within reach and a deposit under it: a vein, a prism, a placer, a pan. What it takes goes to a forge. It stands on land, so never on a lake's water, and a town may grow up at its gate.",
    needs: [
      {
        kind: "settlement",
        holds: within((state) => mapScale(state).resolveMeasure(tappingReach)),
      },
    ],
    excludes: [{ kind: "lake", holds: (_state, a, b) => b.cells.includes(a.anchor) }],
    contains: notApplicable("A mine is one point of work."),
    pairsWith: [
      { kind: "thermalVein", holds: (_state, a, b) => b.cells.includes(a.anchor) },
      { kind: "frostPrism", holds: within(aroundOf) },
      { kind: "placer", holds: (_state, a, b) => b.cells.includes(a.anchor) },
      { kind: "saltPan", holds: (_state, a, b) => b.cells.includes(a.anchor) },
      { kind: "forge", holds: within((state) => 4 * aroundOf(state)) },
    ],
  },
  people: {
    statement:
      "A mine gives materials and trade in proportion to the work kept up; a tap also gives warmth to live by. Its dangers are its own kind: a tap bursts along the fracture it opened, and a quarry or salt working falls in.",
    offers(state, place) {
      const great = factors.magnitude(state, place),
        rich = depositAt(state, place.anchor);
      return {
        materials: (great + rich) / 2,
        trade: great / 2,
        ...(workOf(state, place) === "tapping" ? { power: rich / 2 } : {}),
      };
    },
    threatens: (state, place) => [
      {
        hazard: workOf(state, place) === "tapping" ? "burst along the opened fracture" : "collapse",
        reach: mapScale(state).length(collapseReach),
        severity: factors.magnitude(state, place),
      },
    ],
  },
  time: {
    statement:
      "A working lasts while people keep it up and something is left to take. Abandoned, or with the deposit gone, it ends and leaves a ruin; the pit and cracked rock stay where they are.",
    fate(state, place) {
      const left = depositAt(state, place.anchor) > 0,
        kept = doseOf(state, place) > abandoned;
      return left && kept ? { fate: "persists" } : { fate: "ends", leaves: "ruin" };
    },
  },
  visibility: {
    statement:
      "A mine shows by the work kept up there and by what it cuts into standing richer than the country around it; alone it is a known place, among many it is one of a field. A capital that lives on it carries a small one.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.55, localConditions: 0.2, isolation: 0.25 }),
  },
  naming: {
    statement:
      "Named by those who work it, from the naming the society's work records; it takes the name of the vein or pan it works and may name the town at its gate.",
    namedBy: (state, place) =>
      workings(state).get(place.id)?.culture ?? namingCultureNear(state, place),
    takesNameFrom: [
      { kind: "thermalVein", holds: (_state, a, b) => b.cells.includes(a.anchor) },
      { kind: "saltPan", holds: (_state, a, b) => b.cells.includes(a.anchor) },
    ],
    lendsNameTo: [{ kind: "settlement", holds: within(aroundOf) }],
  },
};
