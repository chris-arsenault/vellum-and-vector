import { chartFootprint, point, spatial, type AtlasFeature, type Position } from "@atlas/domain";
import { reachesOf, waterAt } from "../water/riverKeeping";
import {
  generationFeature,
  generationFeatures,
  removeGenerationFeature,
  writeGenerationFeature,
} from "../generationFeatures";
import { notApplicable, type PoiHostLink, type PoiRelation } from "../poi/poiContract";
import type { PoiKindId } from "../poi/poiKinds";
import type { CapturedCourse } from "../regional/courses";
import type { RegionalState } from "../regional/state";
import type { GenerationState } from "../process";
import type { AreaEntry, AreaPlace } from "./areaContract";
import { mappedRiverCells, riverIdAt, riversOf, type River } from "./riverCourses";
import { continuingRivers, riverIdOfRecord } from "./riverLineage";
import { publishRivers, retainPublishedRiverNames } from "./riverPublish";
import { nativePosition } from "../world/atlasWorkspace";

/** Discharge at which a river is half as great as rivers get, in cubic metres a second. */
const typicalDischarge = 350;
/** The places that stand on a river. */
const standsOnIt: readonly PoiKindId[] = [
  "waterfall",
  "riverMouth",
  "spring",
  "ford",
  "bridge",
  "mill",
  "dam",
  "irrigation",
  "placer",
  "gorge",
];

const areaOf = ({ id, cells }: River): AreaPlace => ({
  id,
  kind: "river",
  extent: { form: "course", cells },
});
/** What a river carries at the last cell it holds on this map. */
function dischargeOf(state: GenerationState, river: AreaPlace) {
  const cells = river.extent.cells ?? [],
    last = cells[cells.length - 1];
  return state.physical && last !== undefined ? waterAt(state.physical.map, last) : 0;
}
const greatness = (state: GenerationState, river: AreaPlace) => {
  const flow = dischargeOf(state, river);
  return flow / (flow + typicalDischarge);
};
const onIt = (kind: PoiKindId): PoiRelation<AreaPlace> => ({
  kind,
  holds: (_state, river, place) => Boolean(river.extent.cells?.includes(place.anchor)),
});

/** The captured position lands on the actual host cells; disconnected pieces add no false edge. */
function cellFor(state: RegionalState, link: PoiHostLink, position: Position) {
  const map = state.physical.map,
    cells = [...reachesOf(map)]
      .filter((reach) => reach.drawn && reach.river === link.hostId)
      .flatMap((reach) => [...reach.cells])
      .filter((cell) => map.mesh.membership(cell) === 1 && map.WaterKindCodes.get(cell) !== 1);
  if (!cells.length) return -1;
  const located = spatial.interiorPosition(
    chartFootprint(point(position), state.surface.bounds, state.surface.periodicWidth)
  );
  return spatial.withIndex(
    cells.map((cell) => point(nativePosition(state.physical, cell))),
    (index) => cells[index.nearest(located)] ?? -1
  );
}
function linkAt(state: GenerationState, cell: number): PoiHostLink | null {
  const hostId = riverIdAt(state, cell);
  return hostId ? { host: "river", hostId } : null;
}
/** No developed record draws the course: the captured river stays on the map as captured. */
function keepCaptured(state: RegionalState, course: CapturedCourse) {
  if (!generationFeature(state, course.feature.id)) writeGenerationFeature(state, course.feature);
}
/** The same generated, unprotected and undetailed policy used by ordinary publication. */
function replaceable(state: GenerationState, feature: AtlasFeature) {
  return (
    feature.state === "generated" &&
    !feature.protected &&
    Object.keys(feature.detail).length === 0 &&
    !Object.values(state.domain.world.areas).some((area) =>
      area.boundary?.crossings.some((crossing) => crossing.featureId === feature.id)
    )
  );
}
/**
 * The developed river stands for the captured course from now on: it takes the name and place
 * identity, carries the course as evidence for the next refinement, and the coarse line gives way
 * to it.
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
  const captured = generationFeature(state, course.feature.id);
  if (captured && replaceable(state, captured)) removeGenerationFeature(state, course.feature.id);
}
/** A continuing river's records draw the captured course: they take its name and identity. */
function adopt(state: RegionalState) {
  const rivers = [...generationFeatures(state, { areaId: state.regional.input.areaId })].filter(
    (feature) => feature.kind === "river"
  );
  for (const { id, course } of continuingRivers(state)) {
    const drawn = rivers.filter(
      (feature) =>
        feature.id !== course.feature.id &&
        replaceable(state, feature) &&
        feature.attributes.developedBy === "regional" &&
        feature.attributes.riverId === id
    );
    if (!drawn.length) keepCaptured(state, course);
    for (const feature of drawn) takeIdentity(state, feature.id, course);
  }
  retainPublishedRiverNames(state);
}
function continues(state: RegionalState, parent: AtlasFeature) {
  const id = riverIdOfRecord(parent),
    river = riversOf(state).find((candidate) => candidate.id === id);
  return river ? areaOf(river) : null;
}

export const river: AreaEntry = {
  id: "river",
  form: "course",
  name: "River",
  recognition: {
    distinct:
      "Water on a course significant at this map's scale, or a river on the coarser map or already published on this one. The channel field records all the water that runs; only these are rivers.",
    covers: (state, cell) => mappedRiverCells(state).has(cell),
  },
  existence: {
    statement:
      "Emerges from the water that gathers on the ground. A course long and full enough for this map's scale is a river, and once it is one it stays one.",
    way: "emerges",
    areas: (state) => riversOf(state).map(areaOf),
  },
  publication: {
    statement:
      "Each river publishes as records of its course, every one saying which river it draws. Every map draws whole courses; a finer map draws the stretches of each that lie inside its frame as one record.",
    moment: "geography",
    publish: (state, context) => publishRivers(state, context),
  },
  lineage: {
    statement:
      "A parent's river continues as the water running from where its course enters this map, under its own identity. Wherever the finer ground bends it, it is that river.",
    identity: (record) => riverIdOfRecord(record),
    continues,
    adopt,
  },
  hosting: {
    statement:
      "A place records its river's identity; its captured position lands on that river's actual cells on a finer map.",
    linkAt,
    cellFor,
  },
  fields: {
    statement:
      "A river's valley, floodplain and bed are the work of the erosion and routing processes, which keep their own writes.",
    terrain: notApplicable("Erosion and routing cut the valley."),
    water: notApplicable("Routing carries the water."),
    climate: notApplicable("Its wetness reaches climate through the water bands."),
    cover: notApplicable("Cover along a channel follows the channel's own moisture."),
    magic: notApplicable("Magic's river carrier reads the water field."),
  },
  movement: {
    statement:
      "Roads pay to cross a river and boats travel along it; both costs read the water field.",
    roads: notApplicable("The way search taxes channels itself."),
    boats: notApplicable("The way search reads the water field."),
    drainage: notApplicable("A river is drainage."),
    magic: notApplicable("Magic's river carrier reads the water field."),
    links: notApplicable("A river joins no two cells for walkers."),
    crosses: notApplicable("A river is what is crossed; fords and bridges cross it."),
  },
  others: {
    statement: "Falls, mouths, crossings and works stand on a river, and move with it.",
    needs: notApplicable("A river needs only water."),
    excludes: notApplicable("A river excludes nothing."),
    contains: standsOnIt.map(onIt),
    pairsWith: notApplicable("What stands on it is what it contains."),
  },
  people: {
    statement: "A river gives people water and a way to trade by it.",
    offers: (state, place) => {
      const share = greatness(state, place);
      return { water: share, trade: share / 2 };
    },
    threatens: notApplicable("Floods are the floodplain's and the society's own hazards."),
  },
  time: {
    statement: "A river lasts as long as the world's history does not end it.",
    fate: () => ({ fate: "persists" }),
  },
  visibility: {
    statement: "A river's weight is the water it carries.",
    magnitude: greatness,
    localConditions: notApplicable("A river is judged by its water alone."),
    isolation: notApplicable("A river is judged by its water alone."),
    cultural: notApplicable("A river is judged by its water alone."),
    importance: greatness,
  },
  naming: {
    statement: "Named when published, by the culture of the country it runs through.",
    namedBy: notApplicable("Its records take a name when they are written."),
    takesNameFrom: notApplicable("A river does not take its name from a place."),
    lendsNameTo: notApplicable("A place taking a river's name is that place's rule."),
  },
};
