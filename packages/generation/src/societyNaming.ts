import {
  languageUse,
  population,
  spatial,
  type AtlasFeature,
  type DomainSnapshot,
  type Entity,
  type SocietyCommunity,
  type SocietyWork,
  type World,
} from "@atlas/domain";
import { createRNG, pickWeighted } from "@atlas/name-forge";
import type { Geometry } from "geojson";
import type { GenerationState, MapProcess } from "./process";
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

function boundsOverlap(a: number[], b: number[]) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
function namingFootprint(state: GenerationState, feature: AtlasFeature): Geometry {
  const line = feature.geometry.type.includes("LineString");
  if (!line && !["ocean", "lake", "river"].includes(feature.kind)) return feature.geometry;
  const grid = state.surface;
  const area = grid.measures.reduce((sum, value) => sum + value, 0);
  const width = Math.sqrt(area / Math.max(1, grid.active.length)) / 2;
  // Water names sample their banks/coasts, where the speakers live, at the map's own resolution.
  return spatial.buffer(feature.geometry, width) ?? feature.geometry;
}
function namingPopulation(state: GenerationState) {
  return (state.society?.region.communities ?? []).flatMap((c) => {
    if (!c.footprint || population(c) <= 0) return [];
    return [
      {
        footprint: c.footprint,
        bounds: spatial.bounds(c.footprint),
        area: Math.max(1, spatial.area(c.footprint)),
        covers: spatial.pointCoverage(c.footprint),
        speakers: Object.entries(languageUse(c.groups)).map(
          ([language, share]) => [language, share * population(c)] as const
        ),
      },
    ];
  });
}
function influence(
  state: GenerationState,
  feature: AtlasFeature,
  residents: ReturnType<typeof namingPopulation>
) {
  const shape = namingFootprint(state, feature),
    bounds = spatial.bounds(shape);
  const measure = shape.type === "Point" ? null : spatial.intersectionArea(shape);
  const result: Record<string, number> = {};
  for (const c of residents) {
    if (!boundsOverlap(bounds, c.bounds)) continue;
    const fraction =
      shape.type === "Point"
        ? Number(
            c.covers({
              x: shape.coordinates[0],
              y: shape.coordinates[1],
              z: shape.coordinates[2] ?? 0,
            })
          )
        : measure!(c.footprint) / c.area;
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
    !original.world.features[feature.id] &&
    !feature.attributes.namedInEra &&
    Boolean(feature.attributes.namingKind)
  );
}
function resolveGeographicName(
  state: GenerationState,
  feature: AtlasFeature,
  era: string,
  residents: ReturnType<typeof namingPopulation>
) {
  const world = state.domain.world;
  const language = state.society
    ? selectLanguage(world, influence(state, feature, residents), feature.id)
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
  const residents = namingPopulation(state);
  for (const feature of Object.values(state.domain.world.features))
    if (newGeographicName(state, original, feature))
      resolveGeographicName(state, feature, era, residents);
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
    refreshPolityLabels(world, original, entity);
  }
}
function refreshPolityLabels(world: World, original: DomainSnapshot, entity: Entity) {
  for (const feature of Object.values(world.features))
    if (
      !original.world.features[feature.id] &&
      feature.state === "generated" &&
      !feature.protected &&
      ["sovereignty", "control", "claim"].includes(feature.kind) &&
      feature.relations.some((r) => r.targetId === entity.id)
    )
      feature.name = `${entity.name} ${feature.kind}`;
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
    behavior: { kind: "extract", extract: (state) => finalizeGeography(state, original) },
    validate: () => [],
  };
}
