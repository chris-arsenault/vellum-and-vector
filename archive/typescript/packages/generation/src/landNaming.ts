import type { AtlasFeature, DomainSnapshot } from "@atlas/domain";
import { createRNG, pickWeighted } from "@atlas/name-forge";
import type { Geometry, Position } from "geojson";
import { nameGeographicFeature, nameMetadata } from "./atlasNaming";
import {
  generationFeatures,
  originalFeatureReader,
  writeGenerationFeature,
} from "./generationFeatures";
import { humanLayersOf } from "./human/humanLayers";
import { held } from "./human/identityReads";
import { traditionOf } from "./human/traditions";
import { takePublishedNames } from "./poi/poiPublish";
import type { GenerationState, MapProcess } from "./process";
import { mapCommand } from "./processTraits";
import { retainPublishedRiverNames } from "./area/riverPublish";

/**
 * Names for the geography a map generated, given by the people who live along it. A river,
 * a range or a sea is named in a tongue spoken on its ground, more likely the more people
 * speak it there; where nobody lives it is named as the ground's own naming tradition does.
 * A name is given once and stays, whoever lives there later.
 */
/** The most places along a feature's shape that are asked who lives there. */
const soundings = 64;

/** Every position of a shape's coordinates, however deeply its kind nests them. */
function positions(value: unknown, into: Position[]) {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === "number") into.push(value as Position);
  else for (const part of value) positions(part, into);
}
function along(geometry: Geometry) {
  const all: Position[] = [];
  if (geometry.type === "GeometryCollection")
    for (const part of geometry.geometries) all.push(...along(part));
  else positions(geometry.coordinates, all);
  const every = Math.max(1, Math.ceil(all.length / soundings));
  return all.filter((_, index) => index % every === 0);
}
/** People speaking each tongue on the ground a feature lies on, by the tongue's entity. */
function speakers(state: GenerationState, feature: AtlasFeature) {
  const work = state.physical;
  if (!work) return {};
  const map = work.map,
    layers = humanLayersOf(map),
    weights: Record<string, number> = {};
  for (const [x, y] of along(feature.geometry)) {
    const cell = map.mesh.cellAt(x - map.mesh.origin[0], y - map.mesh.origin[1]);
    if (cell < 0) continue;
    for (const [code, people] of held(layers.column(cell), "tongue")) {
      const tongue = traditionOf(state, code)?.entity;
      if (tongue) weights[tongue] = (weights[tongue] ?? 0) + people;
    }
  }
  return weights;
}
function chosen(state: GenerationState, feature: AtlasFeature) {
  const spoken = Object.entries(speakers(state, feature))
    .filter(([, people]) => people > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (!spoken.length) return null;
  return pickWeighted(
    createRNG(JSON.stringify([state.domain.world.seed, "naming-language", feature.id])),
    spoken.map(([tongue]) => tongue),
    spoken.map(([, people]) => people)
  );
}
function unnamed(state: GenerationState, original: DomainSnapshot, feature: AtlasFeature) {
  return (
    feature.areaId === state.domain.scope.areaId &&
    feature.state === "generated" &&
    !feature.protected &&
    !originalFeatureReader(state, original).get(feature.id) &&
    !feature.attributes.namedInEra &&
    Boolean(feature.attributes.namingKind)
  );
}
function name(state: GenerationState, feature: AtlasFeature, era: string) {
  const world = state.domain.world,
    language = chosen(state, feature),
    named = nameGeographicFeature(
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
/** Final names read who lives on the land; names already on the source map stay as they are. */
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
    operation: mapCommand(
      "atlas.names",
      "publish",
      (state, context) => {
        const era = context.inputs?.settings
          ? ((context.inputs.settings as { humanEras?: { id: string }[] }).humanEras?.at(-1)?.id ??
            "Before societies")
          : "Before societies";
        for (const feature of generationFeatures(state))
          if (unnamed(state, original, feature)) {
            name(state, feature, era);
            writeGenerationFeature(state, feature);
          }
        // Last: a town takes the name its peak ended up with.
        takePublishedNames(state);
        retainPublishedRiverNames(state);
      },
      []
    ),
    validate: () => [],
  };
}
