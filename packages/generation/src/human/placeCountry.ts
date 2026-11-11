import type { ReadBand } from "@atlas/domain";
import type { GenerationState } from "../process";
import { runOperation } from "../processOperation";
import { runMemory } from "../runMemory";
import type { PhysicalField } from "../world/field";
import { countryOf } from "./hinterlands";
import { travelWays } from "./layerOperations";
import { knownPlaces } from "./placeRegistry";
import { passedOn } from "./reach";
import { travelStep } from "./travel";

/**
 * The country around the known places as an era leaves it: each living place's hinterland,
 * and the ways between neighbouring places with the travellers that use them. The travellers
 * wear the ground of their way, so the next era finds it easier going.
 */
export interface KnownWay {
  /** The places it joins, by their ids. */
  readonly from: string;
  readonly to: string;
  readonly cells: readonly number[];
  readonly cost: number;
  /** People who travel it in a year. */
  readonly travellers: number;
  /** A way over water is a lane; on land, a road where enough travel it and a track below. */
  readonly kind: "lane" | "road" | "track" | "path";
}
/** The share of the smaller place's townsfolk who make the journey to a neighbour in a year. */
const visiting = 0.5;
/** The share of a road's travellers that still wear a track. */
const trackShare = 0.25;
/** How many ranges a place's country and its ways to neighbours may stretch. */
const farthest = 4;

const ways = (state: GenerationState) =>
  runMemory<{ known: KnownWay[] }>(state, "human.ways", () => ({ known: [] }));
export const knownWays = (state: GenerationState): readonly KnownWay[] => ways(state).known;

/** The share of a way's cells over water above which it is sailed, not walked with a ferry. */
const sailed = 0.2;
function kindOf(afloat: number, travellers: number, roadTravellers: number): KnownWay["kind"] {
  if (afloat > sailed) return "lane";
  if (travellers >= roadTravellers) return "road";
  return travellers >= roadTravellers * trackShare ? "track" : "path";
}
/**
 * No place people live in is left without a way: where none of a place's ways is travelled
 * enough to show, its cheapest one is a track all the same.
 */
function reachable(all: KnownWay[]): KnownWay[] {
  // hpc-exempt: one entry per place, a few hundred on a map.
  const cheapest = new Map<string, KnownWay>(),
    shown = new Set<string>();
  for (const way of all)
    for (const end of [way.from, way.to]) {
      if (way.kind !== "path") shown.add(end);
      if (!cheapest.has(end) || way.cost < cheapest.get(end)!.cost) cheapest.set(end, way);
    }
  const raised = new Set([...cheapest].flatMap(([end, way]) => (shown.has(end) ? [] : [way])));
  return all.map((way) => (raised.has(way) ? { ...way, kind: "track" } : way));
}
/**
 * The ways people keep: nobody travels straight between two places when going by way of a
 * third is no farther on either leg, so such a way is not one.
 */
function kept<W extends { from: number; to: number; cost: number }>(all: readonly W[]): W[] {
  // hpc-exempt: the neighbours of a few hundred places.
  const legs = new Map<number, Map<number, number>>();
  const leg = (a: number, b: number, cost: number) => {
    if (!legs.has(a)) legs.set(a, new Map());
    legs.get(a)!.set(b, cost);
  };
  for (const way of all) {
    leg(way.from, way.to, way.cost);
    leg(way.to, way.from, way.cost);
  }
  return all.filter((way) => {
    for (const [third, first] of legs.get(way.from) ?? []) {
      const second = legs.get(way.to)?.get(third);
      if (second !== undefined && first < way.cost && second < way.cost) return false;
    }
    return true;
  });
}
export interface CountrySetting {
  map: PhysicalField;
  /** The answered cost of crossing each cell. */
  friction: Pick<ReadBand, "get">;
  /** The travel distance over which a place is felt. */
  range: number;
  /** Travellers a year that make a road. */
  roadTravellers: number;
  /** The years the era stood for, over which its travellers wore their ways. */
  years: number;
}
export function recordCountry(state: GenerationState, setting: CountrySetting) {
  const { map, friction, range, roadTravellers, years } = setting,
    living = knownPlaces(state).filter((place) => !place.abandoned && !place.absorbedBy),
    country = countryOf(
      map,
      living.map((place) => place.anchor),
      travelStep(map, friction),
      farthest * range
    ),
    worn = map.coverage.scratch("float64", "human:worn", map.mesh.count);
  living.forEach((place, index) => (place.hinterland = country.hinterlands[index]));
  const found = kept(country.ways).map((way): KnownWay => {
    const a = living[way.from],
      b = living[way.to],
      // Fewer make the journey the dearer it is against the distance a place is felt over.
      travellers = visiting * Math.min(a.townPeople, b.townPeople) * passedOn(way.cost, range);
    for (const cell of way.cells) worn.add(cell, travellers * years);
    return {
      from: a.id,
      to: b.id,
      cells: way.cells,
      cost: way.cost,
      travellers,
      kind: kindOf(way.afloat, travellers, roadTravellers),
    };
  });
  ways(state).known = reachable(found);
  runOperation(map, travelWays, { map, travellerYears: worn });
  map.coverage.release(worn);
}
