import {
  MapScale,
  areaSpace,
  spatial,
  type AtlasFeature,
  type Bounds,
  type Position,
} from "@atlas/domain";
import type { BrowserWorkspace } from "@atlas/storage-browser";
import type { InspectedFeature } from "./cellInspection";

/** Pages of 64 features; a point rarely meets more than a few dozen. */
const pageLimit = 64,
  maxPages = 16,
  maxAttributes = 10;

/**
 * The features that explain a clicked cell: areas covering the point, and lines and places
 * within `reach` metres of it (a river through the cell, a settlement on it).
 */
export async function featuresAtCell(
  current: Pick<BrowserWorkspace, "catalog">,
  worldId: string,
  areaId: string,
  position: Position,
  reach: number
): Promise<InspectedFeature[]> {
  const world = await current.catalog.readEditor(worldId);
  const scale = MapScale.fromCells(spatial.bounds(world.areas[areaId].footprint), 1);
  reach = Math.max(reach, scale.length(0.00000025));
  const extent: Bounds = [
      position.x - reach,
      position.y - reach,
      position.x + reach,
      position.y + reach,
    ],
    scope = { worldId, areaId, spaceId: areaSpace(world, areaId) },
    found: InspectedFeature[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const result = await current.catalog.readFeatures({
      scope,
      extent,
      layers: [],
      after,
      limit: pageLimit,
      predicate: "intersects",
      geometry: square(extent),
    });
    for (const { feature } of result.records)
      if (explains(feature, position)) found.push(inspected(feature));
    after = result.next;
    if (!after) break;
  }
  return found.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** An area must cover the point itself; a line or place only has to come within reach. */
function explains(feature: AtlasFeature, position: Position) {
  if (!feature.geometry.type.includes("Polygon")) return true;
  return spatial.pointCoverage(feature.footprint ?? feature.geometry)(position);
}

/** Places and lines first (what is on the cell), then the areas it lies in. */
const rank = (feature: InspectedFeature) =>
  feature.geometryType.includes("Point") ? 0 : feature.geometryType.includes("Line") ? 1 : 2;

function inspected(feature: AtlasFeature): InspectedFeature {
  return {
    id: feature.id,
    name: feature.name,
    kind: feature.kind,
    layerId: feature.layerId,
    geometryType: feature.geometry.type,
    attributes: Object.entries(feature.attributes)
      .filter((entry): entry is [string, string | number | boolean] => shown(...entry))
      .slice(0, maxAttributes),
    causes: feature.causes,
  };
}

/** Scalar facts about the feature; its naming bookkeeping and identifiers are left out. */
function shown(key: string, value: unknown) {
  if (!["string", "number", "boolean"].includes(typeof value)) return false;
  return !/^name|Id$|^id$|language|etymology/i.test(key);
}

function square([w, s, e, n]: Bounds) {
  return {
    type: "Polygon" as const,
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  };
}
