import { MapScale, fieldSampleIndex, type AtlasFeature } from "@atlas/domain";
import { humanChannels } from "../human/humanChannels";
import { nativePosition, parentChannels } from "../world/atlasWorkspace";
import { ask } from "../coupling/answers";
import { nativeContext } from "../world/context";
import { generationBindings } from "../generationBindings";
import { generationFeatures } from "../generationFeatures";
import { humanLayersOf } from "../human/humanLayers";
import {
  liveKeptPass,
  meetPresentLand,
  recordLandPlaces,
  settleInheritedPeople,
} from "../human/landProcesses";
import { adoptPlace, type KnownPlace } from "../human/placeRegistry";
import { restoreTraditions } from "../human/traditions";
import { publishPeoplePlaces } from "../landWays";
import { publishKinds } from "../poi/poiPublish";
import { cellsWithin, featureCell, inhabited } from "../poi/poiReads";
import type { MapProcessContext } from "../process";
import { landReadout } from "./landReadout";
import { isContent, regionalSpan } from "./lattice";
import { developmentExposure } from "./schedule";
import type { RegionalState } from "./state";

/**
 * People on a refined map. The map inherits its parent's human layers and the places the
 * parent named, and its people go on living on the finer land through the same pass the
 * world runs, once in each round of development. No era is lived again and nothing is
 * written back to the parent. At the end the places and ways are read from the layers by
 * the classifiers the world uses, and published by the same catalogue.
 */
const peopleDomains = ["built", "cultural", "political"];
export const placesEnabled = (domains: string[]) =>
  domains.some((id) => peopleDomains.includes(id));
/** The fewest townsfolk any map shows as a place, however fine its cells. */
const hamlet = 40;

/** Everyone living on the map. */
function peopleOn(state: RegionalState) {
  const { mesh } = state.physical.map,
    layers = humanLayersOf(state.physical.map);
  let people = 0;
  for (let cell = 0; cell < mesh.count; cell++)
    people += layers.people(cell) * MapScale.areaUnits(mesh.contentArea(cell), "m2", "km2");
  return people;
}
const peopled = (state: RegionalState) => peopleOn(state) > 0;
/** What the parent's places are known as from the start, before any ground is developed. */
export function preparePeople(state: RegionalState) {
  if (placesEnabled(state.regional.input.domains)) publishKinds(state, "society");
}
/** One round of the inherited people living on the land as the round has developed it. */
export function livePeople(state: RegionalState, context: MapProcessContext) {
  if (!placesEnabled(state.regional.input.domains)) return;
  const before = Math.round(peopleOn(state));
  if (!before) return;
  // The parent's people arrive as one even amount under each of its cells; they take up the
  // finer land once, before they go on living on it.
  if (state.regional.round === 1) settleOnFinerLand(state, context);
  // The round's water and ice are met first: nobody goes on living under a new lake.
  meetPresentLand(state);
  const met = Math.round(peopleOn(state));
  // They settle the finer land and stay as many as the parent says they are.
  liveKeptPass(state, context, developmentExposure[state.regional.round - 1] ?? 0);
  context.progress(1, `Land on the map: ${landReadout(state, context)}`);
  context.progress(
    1,
    `People on the map: ${before} before the round, ${met} after its water and ice, ${Math.round(peopleOn(state))} after living it; the land as now used feeds ${Math.round(landFeeds(state, context))}; all under crops it would feed ${Math.round(landFeeds(state, context, "cropYield"))}, under herds ${Math.round(landFeeds(state, context, "herdYield"))}, left wild ${Math.round(landFeeds(state, context, "wildYield"))}`
  );
}
/** Each cell's parent cell, by the parent sample that gave the cell its people. */
function settleOnFinerLand(state: RegionalState, context: MapProcessContext) {
  const map = state.physical.map,
    parent = parentChannels(state).get(humanChannels[0].name);
  if (!parent) return;
  const groups = map.coverage.scratch("int32", "people:parent-cell", map.mesh.count);
  for (let cell = 0; cell < map.mesh.count; cell++)
    groups.set(
      cell,
      isContent(map.mesh, cell)
        ? fieldSampleIndex(parent, nativePosition(state.physical, cell))
        : -1
    );
  settleInheritedPeople(state, context, groups);
  map.coverage.release(groups);
}
/** Everyone the map's land feeds: as it is now used, or wholly under crops, herds or the wild. */
function landFeeds(
  state: RegionalState,
  context: MapProcessContext,
  by: "support" | "cropYield" | "herdYield" | "wildYield" = "support"
) {
  const map = state.physical.map,
    support = ask(map, by, nativeContext(state, context, 0));
  let fed = 0;
  for (let cell = 0; cell < map.mesh.count; cell++)
    fed += support.get(cell) * MapScale.areaUnits(map.mesh.contentArea(cell), "m2", "km2");
  return fed;
}

const history = (value: unknown): KnownPlace["history"] =>
  Array.isArray(value) ? (value as KnownPlace["history"]) : [];
const earlier = "an earlier age";
/** What a settlement record the parent left says of the place it is. */
function told(f: AtlasFeature) {
  const { attributes } = f,
    townPeople = Number(attributes.settlementPopulation ?? attributes.population ?? 0);
  return {
    id: f.id,
    founded: String(attributes.founded ?? earlier),
    townPeople,
    peak: Number(attributes.peakPopulation ?? townPeople),
    ...(inhabited(f) ? {} : { abandoned: String(attributes.abandoned ?? earlier) }),
    history: history(attributes.history),
  };
}
const captured = (f: AtlasFeature) =>
  f.kind === "settlement" && f.geometry.type === "Point" && f.attributes.developedBy !== "regional";
/**
 * The settlements and ruins the parent left are known places from the start, on the ground
 * the parent's one cell covered, so the crowd found there is that place and keeps its name.
 */
function adoptCaptured(state: RegionalState) {
  const reach = state.regional.parentSpan / 2,
    seats = state.regional.evidence?.seats ?? [];
  for (const f of generationFeatures(state, { areaId: state.regional.input.areaId })) {
    if (!captured(f)) continue;
    const anchor = seats.find((one) => one.featureId === f.id)?.cell ?? featureCell(state, f);
    if (anchor >= 0)
      adoptPlace(state, { ...told(f), anchor, cells: cellsWithin(state, anchor, reach) });
  }
}
/** The townsfolk that make a place on this map: fewer the finer its cells are than its parent's. */
function leastTown(state: RegionalState, worldTown: number) {
  const finer = regionalSpan(state) / state.regional.parentSpan;
  return Math.max(hamlet, worldTown * Math.min(1, finer * finer));
}
/**
 * The map's places and ways, read from its layers as they stand after development and
 * published with the crossings and mills its ways and places make.
 */
export function extractPlaces(state: RegionalState, context: MapProcessContext) {
  if (!placesEnabled(state.regional.input.domains)) return;
  restoreTraditions(state);
  adoptCaptured(state);
  const { parameters, settings } = generationBindings(context),
    town = Number(parameters.townThreshold);
  if (peopled(state)) {
    // The last round's water settled after its people did.
    meetPresentLand(state);
    recordLandPlaces(state, context, {
      era: settings.humanEras.at(-1)?.id ?? "present",
      years: developmentExposure.reduce((sum, years) => sum + years, 0),
      least: leastTown(state, town),
      town,
    });
  }
  publishPeoplePlaces(state, context);
}
