import {
  generationFeature,
  generationFeatures,
  removeGenerationFeature,
  writeGenerationFeature,
} from "../../generationFeatures";
import type { CapturedCourse } from "../courses";
import { continuingRivers } from "../riverLineage";
import type { RegionalState } from "../state";

/**
 * After the world has published the field's geography, carry what only a refinement knows:
 * which developed river is a captured course, and which features are this map's own products
 * (so a later run regenerates them and keeps the captured geography).
 */
export function carryIdentities(state: RegionalState) {
  tagProducts(state);
  carryCourses(state);
}

/** A feature neither captured nor authored is this run's product. */
function tagProducts(state: RegionalState) {
  const areaId = state.regional.input.areaId,
    source = state.sourceFeatures,
    removed = state.regional.removedProducts;
  for (const f of generationFeatures(state, { areaId })) {
    if (f.state !== "generated" || f.protected) continue;
    const captured =
      source?.get(f.id) !== undefined &&
      !removed?.has(f.id) &&
      f.attributes.developedBy !== "regional";
    if (captured || f.attributes.developedBy === "regional") continue;
    writeGenerationFeature(state, {
      ...f,
      attributes: { ...f.attributes, developedBy: "regional" },
    });
  }
}

/** A continuing river's records draw the captured course: they take its name and identity. */
function carryCourses(state: RegionalState) {
  const rivers = [...generationFeatures(state, { areaId: state.regional.input.areaId })].filter(
    (feature) => feature.kind === "river"
  );
  for (const { id, course } of continuingRivers(state)) {
    const drawn = rivers.filter(
      (feature) => feature.id !== course.feature.id && feature.attributes.riverId === id
    );
    if (!drawn.length) keepCaptured(state, course);
    for (const feature of drawn) takeIdentity(state, feature.id, course);
  }
}
/** No developed record draws the course: the captured river stays on the map as captured. */
function keepCaptured(state: RegionalState, course: CapturedCourse) {
  if (!generationFeature(state, course.feature.id)) writeGenerationFeature(state, course.feature);
}

/**
 * The developed river stands for the captured course from now on: it takes the name and
 * place identity, carries the course as evidence for the next refinement, and the coarse
 * line leaves the map.
 */
function takeIdentity(state: RegionalState, featureId: string, course: CapturedCourse) {
  const feature = generationFeature(state, featureId);
  if (!feature) return;
  const carried = course.carried ?? {
    sourceId: course.feature.id,
    geometry: course.feature.geometry,
    discharge: course.discharge,
    order: course.order,
  };
  feature.name = course.feature.name;
  feature.placeId = course.feature.placeId ?? carried.sourceId;
  feature.attributes = {
    ...feature.attributes,
    nameStatus: course.feature.attributes.nameStatus ?? "proper",
    namingCulture: course.feature.attributes.namingCulture,
    namingLanguage: course.feature.attributes.namingLanguage,
    // The name is the captured one; the naming pass leaves a feature named in its era alone.
    namedInEra: course.feature.attributes.namedInEra ?? "captured",
    capturedCourse: carried,
    developedBy: "regional",
  };
  writeGenerationFeature(state, feature);
  if (!course.carried && generationFeature(state, course.feature.id))
    removeGenerationFeature(state, course.feature.id);
}
