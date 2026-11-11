import { canonicalGeometry, unwrapCoordinates } from "@atlas/domain";
import { generationBindings } from "./generationBindings";
import { generationFeature } from "./generationFeatures";
import { knownTraditions } from "./human/traditions";
import { knownWays, type KnownWay } from "./human/placeCountry";
import { knownPlaces, townSize } from "./human/placeRegistry";
import { generatedFeature, generatedId, putGeneratedNetwork } from "./mapFeatures";
import type { GenerationState, MapProcessContext } from "./process";

/**
 * The ways people made, published from the country read around the known places. A way runs
 * between two neighbouring places through the cheapest crossing of the border between their
 * countries. Enough travellers make it a road, fewer a track, and a way over water is a lane.
 * A way too little travelled to show at this map's scale is left for a finer one.
 */
/** Townsfolk above which a place is a market, as the settlement records rank it. */
const marketPeople = 4;

type Point = [number, number];
/**
 * A way is known by the cells it crosses, not by a line through their centres: its drawn
 * course cuts each corner twice, keeping its ends, so it runs through the same country
 * without stepping from centre to centre.
 */
function course(points: Point[]): Point[] {
  let line = points;
  for (let round = 0; round < 2 && line.length > 2; round++) {
    const cut: Point[] = [line[0]];
    for (let n = 0; n + 1 < line.length; n++) {
      const [ax, ay] = line[n],
        [bx, by] = line[n + 1];
      cut.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by]);
      cut.push([0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    cut.push(line[line.length - 1]);
    line = cut;
  }
  return line;
}

/**
 * The ways a realm keeps up as highways: the most travelled land ways out of its seat, as
 * many as the map's setting gives a realm.
 */
function highways(state: GenerationState, shown: readonly KnownWay[], each: number) {
  const kept = new Set<KnownWay>();
  if (each <= 0) return kept;
  for (const realm of knownTraditions(state)) {
    if (realm.kind !== "allegiance" || realm.ended || !realm.seat) continue;
    shown
      .filter(
        (known) => known.kind !== "lane" && (known.from === realm.seat || known.to === realm.seat)
      )
      .sort((a, b) => b.travellers - a.travellers)
      .slice(0, each)
      .forEach((known) => kept.add(known));
  }
  return kept;
}
function way(state: GenerationState, known: KnownWay, highway: boolean) {
  const map = state.physical!.map,
    places = new Map(knownPlaces(state).map((place) => [place.id, place])),
    [a, b] = [places.get(known.from)!, places.get(known.to)!],
    name = (id: string) => generationFeature(state, generatedId(state, id))?.name ?? "",
    kind = known.kind === "lane" ? "lane" : "road";
  return generatedFeature(
    state,
    `${kind}:${a.id}:${b.id}`,
    `${name(a.id)}–${name(b.id)}`,
    kind,
    "roads",
    canonicalGeometry(state.domain.world.reference, {
      type: "LineString",
      coordinates: course(
        unwrapCoordinates(
          known.cells.map((cell) => [
            map.mesh.origin[0] + map.mesh.x(cell),
            map.mesh.origin[1] + map.mesh.y(cell),
          ]),
          state.surface.periodicWidth
        ) as Point[]
      ),
    }),
    {
      fromPlace: generatedId(state, a.id),
      toPlace: generatedId(state, b.id),
      travelCost: known.cost,
      roadClass: highway ? "highway" : known.kind,
      wayKind: known.kind === "lane" ? "sea" : "land",
      travellers: Math.round(known.travellers),
      routePopulation: Math.round(Math.min(a.townPeople, b.townPeople)),
      strategic: [a, b].some((place) => place.townPeople >= marketPeople * townSize(state)),
    }
  );
}
export function publishLandWays(state: GenerationState, context: MapProcessContext) {
  // A way joins two places on the map: where either has no record here, there is no way to draw.
  const recorded = (id: string) => Boolean(generationFeature(state, generatedId(state, id))),
    shown = knownWays(state).filter(
      (known) => known.kind !== "path" && recorded(known.from) && recorded(known.to)
    ),
    kept = highways(state, shown, Number(generationBindings(context).parameters.highways));
  for (const [index, known] of shown.entries()) {
    context.progress(index / shown.length, "Laying the roads people made");
    if (known.cells.length >= 2) putGeneratedNetwork(state, way(state, known, kept.has(known)));
  }
}
