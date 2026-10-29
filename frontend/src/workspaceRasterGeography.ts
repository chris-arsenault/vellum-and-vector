import { polygonParts } from "@atlas/domain";
import type { SpatialCatalog } from "@atlas/storage-browser";
import type { RasterGeography, RasterGeographyReference } from "./types";
import { mergeDisplayFragments } from "./sceneWindows";

/** Geometry moves directly from its GIS owner to the renderer, at the requested map scale. */
export async function workspaceRasterGeography(
  catalog: SpatialCatalog,
  reference: RasterGeographyReference
): Promise<RasterGeography> {
  const geography = [];
  const lakes = new Map<string, RasterGeography["lakes"][number]>();
  for (const extent of reference.windows) {
    geography.push(
      await catalog.readFieldWindow(
        reference.scope,
        reference.geographyId,
        extent,
        reference.tolerance
      )
    );
    let after: string | null = null;
    do {
      const page = await catalog.readDisplay(
        {
          scope: { ...reference.scope, areaId: reference.areaId },
          extent,
          layers: ["lakes"],
          after,
          limit: 128,
          predicate: "intersects",
          geometry: null,
        },
        reference.tolerance
      );
      for (const { feature } of page.records)
        if (feature.kind === "lake" && typeof feature.attributes.waterLevel === "number") {
          const previous = lakes.get(feature.id);
          lakes.set(feature.id, {
            geometry: previous
              ? mergeDisplayFragments(previous.geometry, feature.geometry)
              : feature.geometry,
            level: feature.attributes.waterLevel,
          });
        }
      after = page.next;
    } while (after);
  }
  const parts = geography.flatMap((g) => (g.ocean ? polygonParts(g.ocean) : []));
  mergePhysicalLakes(
    lakes,
    geography.flatMap((g) => g.lakes ?? [])
  );
  return {
    ocean: parts.length
      ? { type: "MultiPolygon", coordinates: parts.map((p) => p.coordinates) }
      : geography.some((g) => g.ocean !== undefined)
        ? null
        : undefined,
    lakes: [...lakes.values()],
  };
}
function mergePhysicalLakes(
  lakes: Map<string, RasterGeography["lakes"][number]>,
  physical: ({ id: string } & RasterGeography["lakes"][number])[]
) {
  for (const lake of physical) {
    const previous = lakes.get(lake.id);
    lakes.set(lake.id, {
      level: lake.level,
      geometry: previous ? mergeDisplayFragments(previous.geometry, lake.geometry) : lake.geometry,
    });
  }
}
