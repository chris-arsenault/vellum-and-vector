import type { Geometry, LineString } from "geojson";
import type { Area, AtlasFeature } from "./model";
import type { DomainSnapshot } from "./operations";
import { spatial } from "./spatial";
import { semanticId } from "./identity";
import { interpolateProfile } from "./lineStations";
import { sampleFields } from "./boundaryContracts";

/** Materialize retained minor channels before fixing the child's crossings. */
export function refinedDrainageFeatures(snapshot: DomainSnapshot, area: Area): AtlasFeature[] {
  if (!["region", "local"].includes(area.profile)) return [];
  const world = snapshot.world;
  const parent = drainageAncestor(snapshot, area);
  if (!parent) return [];
  const result: AtlasFeature[] = [];
  for (const [index, reach] of world.drainage![parent].reaches.entries()) {
    if (reach.featureIds.length || reach.coordinates.length < 2) continue;
    const line: LineString = { type: "LineString", coordinates: reach.coordinates };
    if (!spatial.intersects(line, area.footprint)) continue;
    const clipped = spatial.intersection(line, area.footprint);
    if (!clipped) continue;
    for (const [part, geometry] of lineParts(clipped).entries()) {
      const id = semanticId(
        world.id,
        `generated:${area.id}`,
        `retained-river:${parent}:${index}:${part}`
      );
      const elevations = geometry.coordinates.map(
        ([x, y]) => sampleFields(snapshot, { x, y, z: 0 }).elevation ?? 0
      );
      // The inherited routing supplies direction; monotone water level follows that route.
      for (let i = 1; i < elevations.length; i++)
        elevations[i] = Math.min(elevations[i], elevations[i - 1]);
      result.push({
        id,
        name: `River ${index + 1}`,
        kind: "river",
        layerId: "rivers",
        areaId: area.id,
        geometry,
        attributes: {
          order: reach.order,
          basin: reach.basin,
          elevations,
          discharges: interpolateProfile(
            line,
            { discharges: reach.discharges },
            geometry,
            "discharges"
          ),
          discharge: reach.discharges[0],
          inheritedDrainage: { areaId: parent, reach: index },
        },
        relations: [],
        detail: {},
        protected: false,
        state: "generated",
        actor: "generator",
        generationId: null,
        generationDomain: "physical",
        causes: [`Refined retained drainage reach ${index} from ${parent}.`],
      });
    }
  }
  return result;
}
function drainageAncestor(snapshot: DomainSnapshot, area: Area) {
  if (area.map) return snapshot.world.drainage?.[area.id] ? area.id : null;
  let parent = area.parentId;
  while (parent && !snapshot.world.drainage?.[parent])
    parent = snapshot.world.areas[parent].parentId;
  return parent;
}
function lineParts(geometry: Geometry): LineString[] {
  if (geometry.type === "LineString") return [geometry];
  if (geometry.type === "MultiLineString")
    return geometry.coordinates.map((coordinates) => ({ type: "LineString", coordinates }));
  if (geometry.type === "GeometryCollection") return geometry.geometries.flatMap(lineParts);
  return [];
}
