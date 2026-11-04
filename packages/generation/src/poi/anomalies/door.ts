import { units } from "../../canonry/math";
import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { namingCultureNear, within } from "../poiPlaces";
import { adjacent, cellSpan, fieldOf, gap, heldFor, isLand } from "../poiReads";
import { aloneAmong, attachment, drawnWhen, standsOut } from "../poiVisibilityRules";
import { magicFieldOf, standsIn } from "./anomalyReads";

/** Grass and saplings a door's ring holds at least, as the Veil's writes hold them. */
const ringGrass = 0.3,
  ringSaplings = 0.05;
/** The levels that shut a door, as Veil's pairing tests them. */
const tooWild = 0.1,
  warded = 0.5,
  storedCharge = 300;
/** A house and its keepers are held in regard whatever the door's reach. */
const houseSanctity = 0.4;

const veil = (state: GenerationState) => magicFieldOf(state, "veil");
const othersOf = (state: GenerationState) =>
  (state.physical?.magic?.fields ?? []).filter(
    (field) => field.definition.enabled && field.definition.id !== "veil"
  );
const doorsOf = (state: GenerationState) => veil(state)?.doors ?? [];
/** A door is its pair: both ends, read from Veil's `doors`, which are one crossing. */
const places = (state: GenerationState): readonly PoiPlace[] =>
  heldFor(state, "places:door", () =>
    doorsOf(state).map(({ a, b }) => ({
      id: `door:${a}:${b}`,
      kind: "door" as const,
      cells: a === b ? [a] : [a, b],
      anchor: a,
    }))
  );
const isA = (state: GenerationState, cell: number) =>
  heldFor(state, "cells:door", () => new Set(doorsOf(state).flatMap((d) => [d.a, d.b]))).has(cell);

const fireRelease = (state: GenerationState, cell: number) =>
  othersOf(state).some((f) => f.definition.effects.conduitOpening > 0 && f.source.get(cell) > 0);
const chargeCloses = (state: GenerationState, cell: number) =>
  othersOf(state).some(
    (f) => f.definition.effects.stillness > 0 && f.stored.get(cell) >= storedCharge
  );
const unsettled = (state: GenerationState, cell: number) =>
  (veil(state)?.wild.get(cell) ?? 0) >= tooWild;
const wardSeals = (state: GenerationState, cell: number) =>
  fieldOf(state).Warding.get(cell) >= warded;
const tearStrength = (state: GenerationState, cell: number) =>
  veil(state)?.originSources.tear?.get(cell) ?? 0;
/**
 * Whether a cell could hold a door: Veil's own eligibility, read without the wildness that
 * test writes when a Fire release ruptures a cell.
 */
const holdsOpen = (state: GenerationState, cell: number) =>
  tearStrength(state, cell) >= (veil(state)?.definition.parameters.doorStrain ?? Infinity) &&
  !fireRelease(state, cell) &&
  !unsettled(state, cell) &&
  !wardSeals(state, cell) &&
  !chargeCloses(state, cell);

const around = (state: GenerationState) => 6 * cellSpan(state);
const doorDistance = (state: GenerationState) =>
  veil(state)?.definition.parameters.doorDistance ?? 1;
const spanOf = (state: GenerationState, place: PoiPlace) =>
  place.cells.length > 1 ? gap(state, place.cells[0], place.cells[1]) : 0;
/** Half at the least distance a door can span; near one for a door that joins far countries. */
const reachOf = (state: GenerationState, place: PoiPlace) => {
  const span = spanOf(state, place);
  return span / (span + doorDistance(state));
};
const atEnd = (place: PoiPlace, cell: number): PoiPlace => ({ ...place, anchor: cell });
/** A door has two ends and matters as much at either: a reading is the greater of them. */
const atEitherEnd =
  (read: (state: GenerationState, place: PoiPlace) => number) =>
  (state: GenerationState, place: PoiPlace) =>
    Math.max(...place.cells.map((cell) => read(state, atEnd(place, cell))));
const factors = {
  magnitude: reachOf,
  localConditions: atEitherEnd(
    standsOut((state, cell) => fieldOf(state).Tearing.get(cell), around)
  ),
  isolation: aloneAmong(places, doorDistance),
  cultural: atEitherEnd(attachment(around)),
};

const pool = (state: GenerationState, cell: number): PoiFieldChange => ({
  change: "add",
  band: "Elevation",
  cell,
  amount: -units(veil(state)?.definition.parameters.doorPool ?? 0),
});
const chill = (state: GenerationState, cell: number): PoiFieldChange => ({
  change: "add",
  band: "Temperature",
  cell,
  amount: -(veil(state)?.definition.parameters.doorChill ?? 0),
});
const ring = (state: GenerationState, cell: number): PoiFieldChange[] =>
  [...adjacent(state, cell)]
    .filter((next) => isLand(state, next))
    .flatMap((next): PoiFieldChange[] => [
      { change: "atLeast", band: "GrassCover", cell: next, value: ringGrass },
      { change: "atLeast", band: "BroadleafSaplings", cell: next, value: ringSaplings },
    ]);
const counterpart = counterpartOf(isA, 1);

export const door: PoiEntry = {
  id: "door",
  group: "anomalies",
  name: "Door",
  recognition: {
    distinct:
      "Either end of a pair in Veil's `doors`: two stable tears of matched strength at least the door distance apart, joined as one crossing. It is the only place in the catalogue with two separated cells. A tear is unpaired strain; a wild zone is a tear that moved; a door in a building is a structure's opening and has no Veil field behind it.",
    isA,
  },
  existence: {
    statement:
      "Emerges at the epoch's last magic evaluation: Veil pairs strong, unmoved tears strongest first by nearest strength at a distance. A pair holds from epoch to epoch while both ends still qualify.",
    way: "emerges",
    requires: holdsOpen,
    /** The pairing takes the strongest eligible tears first. */
    suitability: (state, cell) => (holdsOpen(state, cell) ? tearStrength(state, cell) / 1000 : 0),
    places,
  },
  fields: {
    statement:
      "A door barely marks the ground: each end chills its cell, sinks a small pool once, and rings itself with rank grass and saplings. It holds its own cells' Tearing, the stable strain that keeps it open.",
    terrain: (state, place) => place.cells.map((cell) => pool(state, cell)),
    water: (state, place) =>
      place.cells.map((cell) => ({
        change: "atLeast",
        band: "WaterSurfaceElevations",
        cell,
        value: fieldOf(state).Elevation.get(cell),
      })),
    climate: (state, place) => place.cells.map((cell) => chill(state, cell)),
    cover: (state, place) => place.cells.flatMap((cell) => ring(state, cell)),
    magic: (state, place) =>
      place.cells.map((cell) => ({
        change: "atLeast",
        band: "Tearing",
        cell,
        value: fieldOf(state).Tearing.get(cell),
      })),
  },
  acrossMaps: {
    statement:
      "A captured door is established evidence: it stands on the refined map even where the finer strain falls short, and the pairing may add new doors beside it. Its end must be given its pool, chill and ring on the finer ground. An end whose partner lies outside the frame leads nowhere here. Water does not move it.",
    carry: carryWhereItLands,
    realize: (state, carried) => [
      pool(state, carried.cell),
      chill(state, carried.cell),
      ...ring(state, carried.cell),
    ],
    counterpart,
    unrealized: stays,
    settle: notApplicable("A door's ends are cells of its pair; a round's water moves neither."),
  },
  movement: {
    statement:
      "A door joins two distant cells for nothing: a route entering one end leaves by the other at no cost for the distance between, whatever lies between. Its pair is therefore both a road and a way over every barrier. Boats do not pass, and the sunken pool draws a little water. Nothing but a walker goes through: the crust, rivers, wind, currents and ice stop at each end, and a stored Pressure charge cannot pass.",
    roads: costNear(0),
    boats: notApplicable(
      "A crossing joins the dry ground under its ends and is walked; no water passes it."
    ),
    drainage: costNear(0.8),
    magic: notApplicable(
      "Physical carriers stop at each end; what people carry moves by the road rule, and a stored Pressure charge cannot pass at all."
    ),
    crosses: (_state, place) =>
      place.cells.length > 1 ? ["river", "ridge", "strait", "wetland", "ice"] : [],
  },
  others: {
    statement:
      "A door stands in a tear and in nothing that closes it: charged ground shuts it, a Fire release ruptures it, a ward seals it. A town grows at its house and answers to the keepers, and an old door-town can outlast its door as a ruin.",
    needs: [{ kind: "tear", holds: standsIn }],
    excludes: [
      { kind: "auroraField", holds: standsIn },
      { kind: "lightWell", holds: standsIn },
      { kind: "thermalVein", holds: standsIn },
    ],
    contains: notApplicable("Each end is a single cell that holds only the crossing itself."),
    pairsWith: [
      { kind: "settlement", holds: within(around) },
      { kind: "ruin", holds: within(around) },
      { kind: "shrine", holds: within(around) },
      { kind: "wildZone", holds: within(around) },
    ],
  },
  people: {
    statement:
      "A door makes an inland town a port: it brings trade in proportion to the distance saved and a house to keep, and a fortress at a door commands both countries. It unmoors repeat travellers from where they are, and a rupture turns the country around it wild.",
    offers: (state, place) => ({
      trade: reachOf(state, place),
      sanctity: houseSanctity,
      defence: reachOf(state, place) / 2,
    }),
    threatens: (state, place) => [
      {
        hazard: "crossing sickness",
        reach: cellSpan(state),
        severity: reachOf(state, place) / 2,
      },
      { hazard: "rupture into wild ground", reach: around(state), severity: 0.8 },
    ],
  },
  time: {
    statement:
      "A door lasts while both ends qualify; the pair falls as soon as one fails. A Fire release at an end ruptures it and leaves a wild zone, as does a tear that starts to move, whereas charge or a ward closes it quietly and leaves nothing.",
    fate(state, place) {
      if (place.cells.every((cell) => holdsOpen(state, cell))) return { fate: "persists" };
      const broken = place.cells.some((cell) => fireRelease(state, cell) || unsettled(state, cell));
      return broken ? { fate: "ends", leaves: "wildZone" } : { fate: "ends" };
    },
  },
  visibility: {
    statement:
      "A door is seldom small: it shows by the distance it saves and by how few others stand within a door's reach, and the road town at either end carries it at almost any view. How torn the ground looks around it hardly matters.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.5, localConditions: 0.1, isolation: 0.4 }),
  },
  naming: {
    statement:
      "Named by the keepers of its house, often with both end towns in the name; the town that grows up around it may take its name instead.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "settlement", holds: within(around) }],
    lendsNameTo: [{ kind: "settlement", holds: within(around) }],
  },
};
