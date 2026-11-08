// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { MapScale } from "@atlas/domain";
import { mapScale } from "../../worldSignificance";
import { environment } from "../../world/ecologyEnvironment";
import type { GenerationState } from "../../process";
import { farmingValue, fieldGrass, iceOnField, steepestField } from "../../regional/society";
import { carryWhereItLands, costNear, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { namingCultureNear, recordPlaces, sitedPlaces, within } from "../poiPlaces";
import { siteRecord } from "../poiRecords";
import {
  cellSpan,
  cellsWithin,
  celsiusAt,
  featureCell,
  fieldOf,
  gap,
  heldFor,
  iceAt,
  isLand,
  settlementsOf,
  slopeAt,
  treeCoverAt,
} from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { borders, coverCosts, meanOver, sharesNoGround, standsIn, withinOwn } from "./coverShared";

/** Plant water and warmth at which ground would carry trees, so people have trees to take. */
const woodedWater = 0.4,
  woodedWarmth = 2;
/** How far from a community people work ground, in metres. */
const farthestWork = 0.00125;
/** A sited clearance's radius, and how far apart two stand, in metres. */
// length-unit: fraction
const sitedRadius = 0.000625,
  // length-unit: fraction
  siteSpacing = 0.0075;
/** The share of a cleared cell's ground each tree cohort keeps. */
const standing = 0.05;
/** A worked clearance runs lanes that cut a road's cost. */
const fieldLanes = 0.8;
/** Radius in metres at which a clearance is half as great as clearances get. */
const typicalRadius = MapScale.length(0.000625);

const clamped = (value: number) => Math.max(0, Math.min(1, value));
const radiusIn = (state: GenerationState, feature: PoiPlace["feature"]) =>
  Number(feature?.attributes.radius) || mapScale(state).length(sitedRadius);
const footprint = (state: GenerationState, cell: number, radius: number) =>
  cellsWithin(state, cell, radius).filter((other) => isLand(state, other));

/** The cells within a working walk of a community. */
const workedGround = (state: GenerationState) =>
  heldFor(state, "clearance:worked", () => {
    const cells = new Set<number>();
    for (const town of settlementsOf(state)) {
      const at = featureCell(state, town);
      if (at >= 0)
        for (const cell of cellsWithin(state, at, mapScale(state).length(farthestWork)))
          cells.add(cell);
    }
    return cells;
  });
/**
 * It reads the climate that would carry trees, not the trees standing: its own clearing takes
 * those, and the place must not vanish for having done its work.
 */
const requires = (state: GenerationState, cell: number) =>
  isLand(state, cell) &&
  slopeAt(state, cell) <= steepestField &&
  iceAt(state, cell) < mapScale(state).resolveMeasure(iceOnField) &&
  environment(fieldOf(state), cell).moisture >= woodedWater &&
  celsiusAt(state, cell) >= woodedWarmth &&
  workedGround(state).has(cell);
const suitability = (state: GenerationState, cell: number) => {
  const map = fieldOf(state);
  return farmingValue(
    map.SoilDepth.get(cell),
    environment(map, cell).moisture,
    celsiusAt(state, cell),
    map.Slope.get(cell),
    map.scale
  );
};
const recorded = recordPlaces("clearance", (feature) => feature.kind === "clearance");
const sited = sitedPlaces("clearance", requires, suitability, (state) =>
  mapScale(state).length(siteSpacing)
);
/** Recorded works first, then new sites that stand clear of them, each on the ground it covers. */
const places = (state: GenerationState): readonly PoiPlace[] =>
  heldFor(state, "footprints:clearance", () => {
    const works = recorded(state),
      fresh = sited(state).filter((site) =>
        works.every(
          (work) => gap(state, work.anchor, site.anchor) >= mapScale(state).length(siteSpacing)
        )
      );
    return [...works, ...fresh].map((place) => ({
      ...place,
      cells: footprint(state, place.anchor, radiusIn(state, place.feature)),
    }));
  });
const clearedCells = (state: GenerationState) =>
  heldFor(state, "cells:clearance", () => new Set(places(state).flatMap((p) => p.cells)));
const isA = (state: GenerationState, cell: number) => clearedCells(state).has(cell);

const radiusOf = (state: GenerationState, place: PoiPlace) => radiusIn(state, place.feature);
const around = (state: GenerationState, place: PoiPlace) =>
  Math.max(2 * cellSpan(state), 2 * radiusOf(state, place));
const openness = (state: GenerationState, cell: number) => 1 - treeCoverAt(state, cell);
const factors = {
  magnitude: sized(radiusOf, typicalRadius),
  localConditions: standsOut(openness, around),
  isolation: aloneAmong(places, around),
  cultural: attachment(around),
};
const treeBands = [
  "BroadleafCover",
  "ConiferCover",
  "BroadleafSaplings",
  "ConiferSaplings",
] as const;
/**
 * The trees it takes and keeps down, and the grass in their place, as absolute bounds so a
 * repeated evaluation changes nothing further. Where a cell is wider than the clearing, the
 * bounds ease by the share of the cell it opens.
 */
function opened(state: GenerationState, cells: readonly number[], radius: number) {
  const mesh = fieldOf(state).mesh,
    ground = cells.reduce((sum, cell) => sum + mesh.area(cell), 0),
    share = ground > 0 ? Math.min(1, (Math.PI * radius * radius) / ground) : 0,
    ceiling = 1 - share * (1 - standing);
  return cells.flatMap((cell): PoiFieldChange[] => [
    ...treeBands.map((band): PoiFieldChange => ({ change: "atMost", band, cell, value: ceiling })),
    { change: "atMost", band: "TreeCover", cell, value: Math.min(1, 2 * ceiling) },
    { change: "atLeast", band: "GrassCover", cell, value: share * fieldGrass },
  ]);
}

const record = siteRecord({
  kind: "clearance",
  layer: "landUse",
  name: "Clearance",
  attributes: (state, place) => ({ radius: radiusIn(state, place.feature) }),
});

export const clearance: PoiEntry = {
  id: "clearance",
  group: "cover",
  name: "Clearance",
  recognition: {
    distinct:
      "A clearance work and the ground its radius covers: it is decided by the work, never by low tree cover, since grassland is low tree cover nobody cut. A burning is a different work on the same channels.",
    isA,
  },
  existence: {
    statement:
      "Sited by people: recorded works stand where they were made, and beyond those people open the best farming ground within a working walk of a community, on land whose climate carries trees, gentle and free of deep ice. Sites stand at least 10 km apart.",
    way: "sited",
    requires,
    suitability,
    places,
  },
  publication: {
    statement:
      "A clearance publishes as a site on the land-use layer with its radius; a recorded work keeps its own record.",
    moment: "society",
    record: (state, place) => place.feature ?? record(state, place),
  },
  fields: {
    statement:
      "People take the trees and keep them down, and grass stands in their place. The soil wastes, rain runs off faster and less goes back into the air because the soil and climate processes read the opened cover; only the opening itself is this place's own. The cover stays cleared only while people work it.",
    terrain: notApplicable(
      "The soil process writes soil depth over the whole field from its cover."
    ),
    water: notApplicable(
      "The soil process writes infiltration and the climate process writes runoff over the whole field from its cover."
    ),
    climate: notApplicable("The soil process writes evapotranspiration over the whole field."),
    cover: (state, place) => opened(state, place.cells, radiusIn(state, place.feature)),
    magic: notApplicable("Magic's feedback writes verdure over the whole field by intensity."),
  },
  acrossMaps: {
    statement:
      "A captured clearance keeps where it landed, and the child's cover is held open over the ground its radius reaches, each round, because refinement's own ecology would regrow it. It stays where it landed: no fine ground undoes a record.",
    carry: carryWhereItLands,
    realize: (state, carried) => {
      const radius = radiusIn(state, carried.feature);
      return opened(state, footprint(state, carried.cell, radius), radius);
    },
    counterpart: (_state, carried) => carried.cell,
    unrealized: stays,
    settle: notApplicable(
      "A field does not move with a round's water; a flooded one stays recorded, and its people leave."
    ),
    schedule: notApplicable("A clearance does nothing at refinement's other points."),
  },
  movement: {
    statement:
      "Lanes run across worked land, so roads pay less. Opened ground takes channels sooner than wooded ground, and Greenwood's roots find less cover to travel through, because their costs read the opened cover.",
    ...coverCosts,
    roads: costNear(fieldLanes),
  },
  others: {
    statement:
      "It needs the people who keep it and is cut out of forest, with whose edge it runs. It shares no ground with standing water. Irrigation and mills belong to the same people's land.",
    needs: [{ kind: "settlement", holds: within((state) => mapScale(state).length(farthestWork)) }],
    excludes: sharesNoGround("wetland", "lake"),
    contains: standsIn("irrigation"),
    pairsWith: [...borders("forest"), { kind: "mill", holds: withinOwn(around) }],
  },
  people: {
    statement:
      "It gives food from the ground's own farming value, and timber while the trees are coming down. On slopes, wasting soil silts the valley below it.",
    offers: (state, place) => ({
      food: meanOver(state, place, suitability),
      materials: 0.3 * meanOver(state, place, treeCoverAt),
    }),
    threatens(state, place) {
      const steep = meanOver(state, place, slopeAt) / steepestField;
      return steep > 0
        ? [{ hazard: "soil wash", reach: around(state, place), severity: clamped(steep) }]
        : [];
    },
  },
  time: {
    statement:
      "It lasts as long as the work is maintained. When a community goes or stops keeping it up, the ground regrows and it becomes forest.",
    fate: (_state, place) =>
      place.feature?.attributes.maintained === false
        ? { fate: "becomes", kind: "forest" }
        : { fate: "persists" },
  },
  visibility: {
    statement:
      "A clearance is small, so it earns its weight by contrast and by people: a cut-out in deep forest beside a city weighs more than a far larger one on half-open ground. Its people outweigh its size.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.25, localConditions: 0.55, isolation: 0.2 }),
  },
  naming: {
    statement:
      "Named by the community that made it, as the work records, from the plain words for a clearing or fields; failing a record, by the people nearest.",
    namedBy(state, place) {
      const culture = place.feature?.attributes.namingCulture;
      return typeof culture === "string" ? culture : namingCultureNear(state, place);
    },
    takesNameFrom: [{ kind: "settlement", holds: withinOwn(around) }],
    lendsNameTo: notApplicable("It takes the community's name and gives none back."),
  },
};
