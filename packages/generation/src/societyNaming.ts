import {
  foldSamples,
  languageUse,
  population,
  rectangle,
  spatial,
  type AtlasFeature,
  type Bounds,
  type DomainSnapshot,
  type Entity,
  type SocietyCommunity,
  type SocietyWork,
  type World,
} from "@atlas/domain";
import { createRNG, pickWeighted } from "@atlas/name-forge";
import type { Geometry } from "geojson";
import type { GenerationState, MapProcess } from "./process";
import { takePublishedNames } from "./poi/poiPublish";
import {
  generationFeatures,
  writeGenerationFeature,
  originalFeatureReader,
} from "./generationFeatures";
import { atlasName, nameGeographicFeature, nameMetadata } from "./atlasNaming";
import { polityCharacter, polityTerm } from "./societyCharacter";

function selectLanguage(world: World, weights: Record<string, number>, key: string) {
  const entries = Object.entries(weights)
    .filter(([, weight]) => weight > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return null;
  return pickWeighted(
    createRNG(JSON.stringify([world.seed, "naming-language", key])),
    entries.map(([id]) => id),
    entries.map(([, weight]) => weight)
  );
}
export function communityName(world: World, community: SocietyCommunity, era: string) {
  const language = selectLanguage(world, languageUse(community.groups), community.id);
  return atlasName(world, {
    key: community.id,
    kind: "settlement",
    position: community.position,
    language,
    era,
  });
}
export function societyWorkName(world: World, community: SocietyCommunity, work: SocietyWork) {
  const language = selectLanguage(world, languageUse(community.groups), work.id);
  return atlasName(world, {
    key: work.id,
    kind: "societyWork",
    subkind: work.kind,
    position: work.position,
    language,
    era: work.built,
  });
}
/**
 * Seat language establishes a polity's name without replacing languages inside its territory;
 * the word the name ends in follows the polity's character once it has one.
 */
export function namePolity(
  world: World,
  entity: Entity,
  seat: SocietyCommunity,
  era: string,
  term = "Commonwealth"
) {
  if (entity.state !== "generated" || entity.attributes.namedInEra) return;
  const language = selectLanguage(world, languageUse(seat.groups), entity.id);
  if (!language) return;
  const named = atlasName(world, {
    key: entity.id,
    kind: "polity",
    subkind: "commonwealth",
    term,
    position: seat.position,
    language,
    era,
  });
  entity.name = named.name;
  Object.assign(entity.attributes, nameMetadata(named));
}

function namingRadius(feature: AtlasFeature, width: number) {
  const line = feature.geometry.type.includes("LineString");
  // Water names sample their banks/coasts, where the speakers live, at the map's own resolution.
  return line || ["ocean", "lake", "river"].includes(feature.kind) ? width : 0;
}
const expanded = ([x0, y0, x1, y1]: Bounds, width: number): Bounds => [
  x0 - width,
  y0 - width,
  x1 + width,
  y1 + width,
];
function namingPopulation(state: GenerationState) {
  return (state.society?.region.communities ?? []).flatMap((c) => {
    if (!c.footprint || population(c) <= 0) return [];
    return [
      {
        footprint: c.footprint,
        area: Math.max(1, spatial.area(c.footprint)),
        bounds: spatial.bounds(c.footprint),
        covers: spatial.pointCoverage(c.footprint),
        measure: spatial.intersectionArea(c.footprint),
        speakers: Object.entries(languageUse(c.groups)).map(
          ([language, share]) => [language, share * population(c)] as const
        ),
      },
    ];
  });
}
type Residents = (bounds: Bounds) => ReturnType<typeof namingPopulation>;
/** Only geography within the naming radius of these speakers can contribute to their overlap. */
function residentShare(shape: Geometry, radius: number, resident: ReturnType<Residents>[number]) {
  if (shape.type === "Point")
    return Number(
      resident.covers({
        x: shape.coordinates[0],
        y: shape.coordinates[1],
        z: shape.coordinates[2] ?? 0,
      })
    );
  if (radius === 0) return resident.measure(shape) / resident.area;
  // Buffering a whole river or ridge network can exhaust native memory. Clip before buffering,
  // including the radius outside the community so lines just beyond its boundary still count.
  const bounds = expanded(resident.bounds, radius + spatial.precision),
    // Rectangle clipping keeps line crossings unnoded; overlay would split them into many pieces.
    local = shape.type.includes("LineString")
      ? spatial.clipByRect(shape, bounds)
      : spatial.intersection(shape, rectangle(bounds));
  if (!local) return 0;
  const nearby = spatial.buffer(local, radius);
  return nearby ? resident.measure(nearby) / resident.area : 0;
}
function influence(feature: AtlasFeature, residents: Residents, width: number) {
  const shape = feature.geometry,
    radius = namingRadius(feature, width),
    bounds = expanded(spatial.bounds(shape), radius);
  const result: Record<string, number> = {};
  for (const c of residents(bounds)) {
    const fraction = residentShare(shape, radius, c);
    if (fraction <= 0) continue;
    for (const [language, speakers] of c.speakers)
      result[language] = (result[language] ?? 0) + speakers * fraction;
  }
  return result;
}
function newGeographicName(
  state: GenerationState,
  original: DomainSnapshot,
  feature: AtlasFeature
) {
  return (
    feature.areaId === state.domain.scope.areaId &&
    feature.state === "generated" &&
    !feature.protected &&
    !originalFeatureReader(state, original).get(feature.id) &&
    !feature.attributes.namedInEra &&
    Boolean(feature.attributes.namingKind)
  );
}
function resolveGeographicName(
  state: GenerationState,
  feature: AtlasFeature,
  era: string,
  residents: Residents,
  width: number
) {
  const world = state.domain.world;
  const language = state.society
    ? selectLanguage(world, influence(feature, residents, width), feature.id)
    : null;
  const named = nameGeographicFeature(
    world,
    feature.id,
    feature.kind,
    feature.geometry,
    feature.attributes,
    { language, era }
  );
  if (!named) return;
  feature.name = named.name;
  Object.assign(feature.attributes, nameMetadata(named));
  if (language)
    feature.causes.push(
      `Named during ${era} from local use of ${world.entities[language]?.name ?? language}.`
    );
}
function finalizeGeography(state: GenerationState, original: DomainSnapshot) {
  const era = state.society?.region.history.at(-1)?.id ?? "Before societies";
  finalizePolities(state, original, era);
  const residents = namingPopulation(state),
    grid = state.surface,
    area = foldSamples(grid.measures, (sum, value) => sum + value, 0),
    width = Math.sqrt(area / Math.max(1, grid.active.length)) / 2;
  // Communities whose footprint envelopes meet a feature's naming footprint, from a native index.
  spatial.withIndex(
    residents.map((c) => c.footprint),
    (index) => {
      const near: Residents = (bounds) => index.query(bounds).map((i) => residents[i]);
      for (const feature of generationFeatures(state))
        if (newGeographicName(state, original, feature)) {
          resolveGeographicName(state, feature, era, near, width);
          writeGenerationFeature(state, feature);
        }
    }
  );
  // Last: a town takes the name its peak ended up with.
  takePublishedNames(state);
}
function finalizePolities(state: GenerationState, original: DomainSnapshot, era: string) {
  const world = state.domain.world,
    region = state.society?.region;
  if (!region?.politics) return;
  for (const polity of region.politics.polities) {
    const entity = world.entities[polity.id],
      seat = region.communities.find((c) => c.id === polity.seat);
    if (!seat || original.world.entities[entity.id] || entity.state !== "generated") continue;
    const character = polityCharacter(region, polity);
    entity.attributes.character = character;
    namePolity(world, entity, seat, era, polityTerm(character));
    entity.attributes.namedInEra ??= era;
    refreshPolityLabels(state, original, entity);
  }
}
function refreshPolityLabels(state: GenerationState, original: DomainSnapshot, entity: Entity) {
  for (const feature of generationFeatures(state))
    if (
      !originalFeatureReader(state, original).get(feature.id) &&
      feature.state === "generated" &&
      !feature.protected &&
      ["sovereignty", "control", "claim"].includes(feature.kind) &&
      feature.relations.some((r) => r.targetId === entity.id)
    ) {
      feature.name = `${entity.name} ${feature.kind}`;
      writeGenerationFeature(state, feature);
    }
}
/** Final names consume the completed society state; source-map names remain historical facts. */
export function finalizeNamesProcess(original: DomainSnapshot): MapProcess {
  return {
    contract: {
      id: "atlas.names",
      version: "1",
      parameters: {},
      requires: [],
      produces: ["atlasNames"],
      invalidates: [],
    },
    behavior: {
      kind: "extract",
      extract(state) {
        finalizeGeography(state, original);
      },
    },
    validate: () => [],
  };
}
