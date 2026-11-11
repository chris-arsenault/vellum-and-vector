import { MapScale, humanLayers } from "@atlas/domain";
import { ask } from "../../../packages/generation/src/coupling/answers";
import { recordEraPlaces } from "../../../packages/generation/src/human/eraPlaces";
import { humanLayersOf } from "../../../packages/generation/src/human/humanLayers";
import { liveIdentities } from "../../../packages/generation/src/human/identityPass";
import {
  leadingOf,
  type TraditionField,
} from "../../../packages/generation/src/human/identityReads";
import { knownWays } from "../../../packages/generation/src/human/placeCountry";
import { knownPlaces } from "../../../packages/generation/src/human/placeRegistry";
import { passage } from "../../../packages/generation/src/human/reach";
import { liveRealms } from "../../../packages/generation/src/human/realmPass";
import { knownTraditions } from "../../../packages/generation/src/human/traditions";
import { travelStep } from "../../../packages/generation/src/human/travel";
import type { GenerationState } from "../../../packages/generation/src/process";
import { runOperation } from "../../../packages/generation/src/processOperation";
import type { PhysicalContext } from "../../../packages/generation/src/world/context";
import type { PhysicalField } from "../../../packages/generation/src/world/field";
import { drawCells } from "./reliefSystems";

/**
 * What follows an era's passes on the land in the people harness: identity, the era's places,
 * and realms, with the app's default settings, run as the generation sequence runs them; and
 * pictures and counts of what the identity column then says.
 */
/** The app's defaults for what the sequence reads from its parameters. */
const defaults = {
  townSize: 5000,
  cityReach: 0.05,
  roadTravellers: 1000,
  founders: 3,
  realms: 3,
  seatReach: 0.0625,
};
export interface HarnessEra {
  id: string;
  years: number;
  mobility: number;
  politicalCapacity: number;
}
export function liveEraIdentity(
  state: GenerationState,
  map: PhysicalField,
  context: PhysicalContext,
  era: HarnessEra,
  removed: ReadonlySet<string>
) {
  const range = map.scale.length(defaults.cityReach),
    step = travelStep(map, ask(map, "travelFriction", context));
  if (!removed.has("identity")) {
    const going = passage(map, step, range);
    runOperation(map, liveIdentities, {
      state,
      map,
      step,
      going,
      era: era.id,
      years: era.years,
      // With overlay removed nobody takes up a neighbour's ways: one layer stays everywhere.
      mobility: removed.has("overlay") ? 0 : era.mobility,
      founders: defaults.founders,
    });
    map.coverage.release(going.passed);
  }
  recordEraPlaces(state, {
    map,
    context,
    era: era.id,
    years: era.years,
    least: defaults.townSize,
    range,
    roadTravellers: defaults.roadTravellers,
  });
  if (!removed.has("realms"))
    runOperation(map, liveRealms, {
      state,
      map,
      step,
      era: era.id,
      years: era.years,
      reach: map.scale.length(defaults.seatReach),
      capacity: era.politicalCapacity,
      realms: defaults.realms,
    });
}
/** A colour for a tradition code that stays the same from run to run and differs between codes. */
function colour(code: number): [number, number, number] {
  const hue = (code * 137.508) % 360,
    f = (n: number) => {
      const k = (n + hue / 60) % 6;
      return Math.round(255 * (0.82 - 0.42 * Math.max(0, Math.min(k, 4 - k, 1))));
    };
  return [f(5), f(3), f(1)];
}
const land = (map: PhysicalField, cell: number) =>
  map.mesh.membership(cell) === 1 && map.WaterKindCodes.get(cell) === 0;
/** Every cell coloured by the code most of its people hold; places are black, seats red. */
function drawLeading(
  state: GenerationState,
  map: PhysicalField,
  out: string,
  field: TraditionField
) {
  const leading = leadingOf(map, field),
    seats = new Set(knownTraditions(state).flatMap((realm) => (realm.seat ? [realm.seat] : []))),
    marks = new Map(
      knownPlaces(state)
        .filter((place) => !place.abandoned && !place.absorbedBy)
        .map((place) => [place.anchor, seats.has(place.id)])
    );
  drawCells(map, out, `${field}.png`, (cell) => {
    if (!land(map, cell)) return [170, 185, 205];
    if (marks.has(cell)) return marks.get(cell) ? [200, 0, 0] : [0, 0, 0];
    return leading.code[cell] ? colour(leading.code[cell]) : [245, 245, 245];
  });
}
/** People holding each tradition as their cell's leading one, by tradition. */
function holders(state: GenerationState, map: PhysicalField, field: TraditionField) {
  const leading = leadingOf(map, field),
    totals = new Map<number, { people: number; km2: number }>();
  for (let cell = 0; cell < map.mesh.count; cell++) {
    const code = leading.code[cell];
    if (!code || !land(map, cell)) continue;
    const km2 = MapScale.areaUnits(map.mesh.area(cell), "m2", "km2"),
      total = totals.get(code) ?? { people: 0, km2: 0 };
    total.people += map[humanLayers.population].get(cell) * km2;
    total.km2 += km2;
    totals.set(code, total);
  }
  return knownTraditions(state)
    .filter((tradition) => totals.has(tradition.code))
    .map((tradition) => ({
      name: state.domain.world.entities[tradition.entity]?.name,
      founded: tradition.founded,
      parent: tradition.parent
        ? state.domain.world.entities[knownTraditions(state)[tradition.parent - 1].entity]?.name
        : undefined,
      people: Math.round(totals.get(tradition.code)!.people),
      km2: Math.round(totals.get(tradition.code)!.km2),
    }))
    .sort((a, b) => b.people - a.people);
}
export function identityReport(state: GenerationState, map: PhysicalField, out: string) {
  for (const field of ["tongue", "faith", "custom", "allegiance"] as const)
    drawLeading(state, map, out, field);
  const places = knownPlaces(state),
    layers = humanLayersOf(map);
  let peopled = 0,
    layered = 0;
  for (let cell = 0; cell < map.mesh.count; cell++) {
    const depth = layers.column(cell).length;
    if (depth > 0) peopled++;
    if (depth > 1) layered++;
  }
  return {
    // Cells whose people hold anything, and those where one identity lies over another.
    cellsHoldingIdentity: peopled,
    cellsWithLayersBeneath: layered,
    tongues: holders(state, map, "tongue"),
    faiths: holders(state, map, "faith"),
    customs: holders(state, map, "custom"),
    realms: holders(state, map, "allegiance"),
    places: {
      living: places.filter((place) => !place.abandoned && !place.absorbedBy).length,
      abandoned: places.filter((place) => place.abandoned).length,
      absorbed: places.filter((place) => place.absorbedBy).length,
      townsfolk: Math.round(places.reduce((sum, place) => sum + place.townPeople, 0)),
      greatest: [...places]
        .sort((a, b) => b.townPeople - a.townPeople)
        .slice(0, 8)
        .map((place) => ({
          id: place.id,
          founded: place.founded,
          townsfolk: Math.round(place.townPeople),
        })),
    },
    ways: Object.fromEntries(
      ["road", "track", "lane", "path"].map((kind) => [
        kind,
        knownWays(state).filter((way) => way.kind === kind).length,
      ])
    ),
  };
}
