import type { Geometry } from "geojson";
import { requireThat } from "./errors";
import { profiles, type Area, type AtlasFeature, type World, type Profile } from "./model";
import { spatial, Spatial } from "./spatial";

export function geometryParts(g: Geometry | null): Geometry[] {
  if (g === null) return [];
  if (g.type === "GeometryCollection") return g.geometries.flatMap(geometryParts);
  if (g.type === "MultiLineString")
    return g.coordinates.map((coordinates) => ({ type: "LineString", coordinates }));
  if (g.type === "MultiPolygon")
    return g.coordinates.map((coordinates) => ({ type: "Polygon", coordinates }));
  if (g.type === "MultiPoint")
    return g.coordinates.map((coordinates) => ({ type: "Point", coordinates }));
  return [g];
}
export function geometryDimension(g: Geometry): number {
  if (g.type === "GeometryCollection") return Math.max(...g.geometries.map(geometryDimension));
  if (g.type.includes("Polygon")) return 2;
  return g.type.includes("LineString") ? 1 : 0;
}
export function combineGeometry(
  parts: Geometry[],
  dimension: number,
  gis = spatial
): Geometry | null {
  const matching = parts.flatMap(geometryParts).filter((p) => geometryDimension(p) === dimension);
  if (matching.length === 0) return null;
  if (matching.length === 1) return matching[0];
  if (dimension === 2) return matching.reduce((a, b) => gis.union(a, b));
  if (dimension === 1)
    return {
      type: "MultiLineString",
      coordinates: matching.map((g) => {
        requireThat(
          g.type === "LineString",
          "geometry_dimension",
          "Expected a directed line part."
        );
        return g.coordinates;
      }),
    };
  return {
    type: "MultiPoint",
    coordinates: matching.map((g) => {
      requireThat(g.type === "Point", "geometry_dimension", "Expected a point part.");
      return g.coordinates;
    }),
  };
}
export function areaSpace(world: Pick<World, "id" | "areas">, id: string): string {
  const visited = new Set<string>();
  for (let next: string | null = id; next !== null;) {
    requireThat(!visited.has(next), "area_cycle", "Geographic ancestry contains a cycle.");
    visited.add(next);
    const area: Area | undefined = world.areas[next];
    requireThat(area, "missing_area_context", "Scoped inputs lack required area ancestry.");
    if (area.spaceId) return area.spaceId;
    if (area.profile === "interior" || area.context === "cave" || area.frame.floor !== null)
      return area.id;
    next = area.parentId;
  }
  return world.id;
}
export function isDescendant(
  areas: Record<string, Area>,
  child: string,
  ancestor: string
): boolean {
  const seen = new Set<string>();
  for (let id: string | null = child; id !== null;) {
    if (id === ancestor) return true;
    requireThat(!seen.has(id), "area_cycle", "Geographic ancestry contains a cycle.");
    seen.add(id);
    id = areas[id]?.parentId ?? null;
  }
  return false;
}
export function composeFeature(
  world: Pick<World, "id" | "areas" | "features"> & Partial<Pick<World, "reference">>,
  feature: AtlasFeature,
  path: string[] = [],
  profile?: Profile
): Geometry | null {
  requireThat(
    !path.includes(feature.id),
    "binding_cycle",
    "Following relationships must be acyclic."
  );
  const dimension = geometryDimension(feature.geometry),
    ownArea = world.areas[feature.areaId];
  const gis = new Spatial(world.reference?.precision);
  requireThat(ownArea, "missing_area_context", "A feature needs its located area context.");
  const follows = feature.relations.filter((r) => r.kind === "follows");
  let geometry: Geometry | null = feature.geometry;
  if (follows.length) {
    requireThat(
      dimension === 1,
      "binding_geometry",
      "Following relationships require line geometry."
    );
    geometry = combineGeometry(
      follows.flatMap((r) => {
        const target = world.features[r.targetId];
        requireThat(
          target,
          "missing_binding",
          "A following relationship needs its source feature."
        );
        requireThat(
          areaSpace(world, target.areaId) === areaSpace(world, feature.areaId),
          "binding_space",
          "A line can follow geography in its own located space."
        );
        const composed = composeFeature(world, target, [...path, feature.id], profile);
        return composed ? geometryParts(gis.intersection(composed, ownArea.footprint)) : [];
      }),
      dimension,
      gis
    );
  }
  const details = Object.entries(feature.detail)
    .filter(
      ([id, d]) =>
        (!profile || profiles.indexOf(world.areas[id].profile) <= profiles.indexOf(profile)) &&
        !d.needsReconciliation &&
        d.state !== "stale" &&
        d.state !== "unmaterialized" &&
        areaSpace(world, id) === areaSpace(world, feature.areaId)
    )
    .sort(
      ([a], [b]) =>
        profiles.indexOf(world.areas[a].profile) - profiles.indexOf(world.areas[b].profile) ||
        a.localeCompare(b)
    );
  for (const [id, detail] of details) {
    const footprint = world.areas[id].footprint;
    const remaining = geometry ? geometryParts(gis.difference(geometry, footprint)) : [];
    const added =
      detail.state === "intentionallyEmpty"
        ? []
        : geometryParts(gis.intersection(detail.geometry, footprint));
    geometry = combineGeometry([...remaining, ...added], dimension, gis);
  }
  return geometry;
}

/** The physical/affected extent composes independently from a site's point or course. */
export function composeFootprint(world: World, feature: AtlasFeature, profile?: Profile) {
  const initial = Object.entries(feature.detail).find(
    ([id, representation]) =>
      representation.footprint &&
      (!profile || profiles.indexOf(world.areas[id].profile) <= profiles.indexOf(profile)) &&
      !representation.needsReconciliation &&
      !["stale", "unmaterialized", "intentionallyEmpty"].includes(representation.state) &&
      areaSpace(world, id) === areaSpace(world, feature.areaId)
  );
  const base = feature.footprint ?? initial?.[1].footprint;
  if (!base) return null;
  const detail = Object.fromEntries(
    Object.entries(feature.detail).flatMap(([id, representation]) =>
      representation.footprint || representation.state === "intentionallyEmpty"
        ? [[id, { ...representation, geometry: representation.footprint ?? base }]]
        : []
    )
  );
  return composeFeature(world, { ...feature, geometry: base, detail, relations: [] }, [], profile);
}
