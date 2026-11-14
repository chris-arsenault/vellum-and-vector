import { canonicalGeometry, lineParts, unwrapCoordinates, type AtlasFeature } from "@atlas/domain";
import { generationBindings } from "./generationBindings";
import { generationFeature, writeGenerationFeature } from "./generationFeatures";
import { knownTraditions } from "./human/traditions";
import { knownWays, type KnownWay } from "./human/placeCountry";
import { knownPlaces, rankedSize, type KnownPlace } from "./human/placeRegistry";
import { generatedFeature, putGeneratedNetwork } from "./mapFeatures";
import { publishKinds, publishLatePlaces } from "./poi/poiPublish";
import { placeRecordId } from "./poi/settlements/landPlaces";
import type { GenerationState, MapProcessContext } from "./process";
import { putRegionalNetwork, regionalFeature } from "./regional/extraction/features";
import type { RegionalState } from "./regional/state";
import type { PhysicalField } from "./world/field";

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

/** A way's cells as unbroken runs: a new run begins wherever the next cell is not a neighbour. */
function stretches(map: PhysicalField, cells: readonly number[]) {
  const runs: number[][] = [];
  cells.forEach((cell, n) => {
    const before = cells[n - 1];
    let touching = false;
    for (let edge = 0; n > 0 && edge < map.mesh.degree(before); edge++)
      touching ||= map.mesh.neighbor(before, edge) === cell;
    if (touching) runs.at(-1)!.push(cell);
    else runs.push([cell]);
  });
  return runs.filter((run) => run.length > 1);
}
/** The line a way is drawn as: one course, or one for each run between its crossings. */
function drawn(state: GenerationState, runs: readonly number[][]) {
  const map = state.physical!.map,
    lines = runs.map((run) =>
      course(
        unwrapCoordinates(
          run.map((cell) => [
            map.mesh.origin[0] + map.mesh.x(cell),
            map.mesh.origin[1] + map.mesh.y(cell),
          ]),
          state.surface.periodicWidth
        ) as Point[]
      )
    );
  return lines.length === 1
    ? { type: "LineString" as const, coordinates: lines[0] }
    : { type: "MultiLineString" as const, coordinates: lines };
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
const refined = (state: GenerationState): state is RegionalState => "regional" in state;
const placeRecord = placeRecordId;
function way(state: GenerationState, known: KnownWay, highway: boolean) {
  const map = state.physical!.map,
    places = new Map(knownPlaces(state).map((place) => [place.id, place])),
    [a, b] = [places.get(known.from)!, places.get(known.to)!],
    name = (place: KnownPlace) => generationFeature(state, placeRecord(state, place))?.name ?? "",
    kind = known.kind === "lane" ? "lane" : "road",
    runs = stretches(map, known.cells),
    key = `${kind}:${a.id}:${b.id}`,
    label = `${name(a)}–${name(b)}`,
    geometry = canonicalGeometry(state.domain.world.reference, drawn(state, runs)),
    attributes = {
      // A way that takes a step between cells that do not touch is drawn up to it and on
      // from its far end.
      ...(runs.length > 1 ? { crossings: runs.length - 1 } : {}),
      fromPlace: placeRecord(state, a),
      toPlace: placeRecord(state, b),
      travelCost: known.cost,
      roadClass: highway ? "highway" : known.kind,
      wayKind: known.kind === "lane" ? "sea" : "land",
      travellers: Math.round(known.travellers),
      routePopulation: Math.round(Math.min(a.townPeople, b.townPeople)),
      strategic: [a, b].some((place) => place.townPeople >= marketPeople * rankedSize(state)),
    };
  if (!refined(state))
    return generatedFeature(state, key, label, kind, "roads", geometry, attributes);
  // A refined map's ways are its own products, named for the places they join.
  return regionalFeature(state, key, kind, "roads", geometry, attributes, label, true);
}
/** A way's record and its network, written as this map writes its own. */
function lay(state: GenerationState, feature: AtlasFeature) {
  if (!refined(state)) return putGeneratedNetwork(state, feature);
  writeGenerationFeature(state, feature);
  for (const coordinates of lineParts(feature.geometry))
    putRegionalNetwork(state, feature, Number(feature.attributes.travellers), coordinates);
}
/** The places of the catalogue's society moment, and the ways between the places of the land. */
export function publishPeoplePlaces(state: GenerationState, context: MapProcessContext) {
  publishKinds(state, "society");
  publishLatePlaces(state, "society");
  publishLandWays(state, context);
}
export function publishLandWays(state: GenerationState, context: MapProcessContext) {
  // A way joins two places on the map: where either has no record here, there is no way to draw.
  const places = new Map(knownPlaces(state).map((place) => [place.id, place])),
    recorded = (id: string) => {
      const place = places.get(id);
      return Boolean(place && generationFeature(state, placeRecord(state, place)));
    },
    shown = knownWays(state).filter(
      (known) => known.kind !== "path" && recorded(known.from) && recorded(known.to)
    ),
    kept = highways(state, shown, Number(generationBindings(context).parameters.highways));
  for (const [index, known] of shown.entries()) {
    context.progress(index / shown.length, "Laying the roads people made");
    if (stretches(state.physical!.map, known.cells).length)
      lay(state, way(state, known, kept.has(known)));
  }
}
