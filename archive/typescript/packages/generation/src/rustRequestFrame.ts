import {
  areaSpace,
  chartFootprint,
  compactGeometryBounds,
  ownsMapGeography,
  requireThat,
  spatial,
  type DomainSnapshot,
} from "@atlas/domain";
import type { AtlasGenerationInput } from "./atlasWorkflow";
import { isRegionalRefinement, refinementFrame, refinementResolution } from "./regional/capture";
import { regionalResolution } from "./regionalInputs";
import { mapBoundaryValue } from "./atlasParameters";

export function rustRequestFrame(source: DomainSnapshot, input: AtlasGenerationInput) {
  const regional = isRegionalRefinement(source, input.areaId),
    original = source.world.areas[input.areaId],
    area = regional
      ? { ...original, footprint: refinementFrame(source, input.areaId).footprint }
      : original,
    cellSpan = regional
      ? refinementResolution(source, input).cellSpan
      : regionalResolution(source, area.id, input.quality).cellSpan,
    bounds = compactGeometryBounds(source.world.reference, area.footprint),
    domainBounds = spatial.bounds(source.world.reference.domain),
    cylinder = source.world.reference.boundaryMode === "cylinder",
    coordinateWidth = cylinder ? domainBounds[2] - domainBounds[0] : null,
    band = Math.min(cellSpan, (bounds[2] - bounds[0]) / 4, (bounds[3] - bounds[1]) / 4);
  const interior =
    area.boundary && !["region", "local"].includes(area.profile)
      ? spatial.buffer(area.footprint, -band)
      : area.footprint;
  requireThat(
    interior && spatial.area(interior) > 0,
    "generation_extent",
    "Choose an extent with room for interior field samples."
  );
  const scope = {
    ...source.scope,
    worldId: source.world.id,
    areaId: area.id,
    spaceId: areaSpace(source.world, area.id),
    footprint: area.footprint,
    crsId: source.world.reference.id,
    revision: source.world.version,
    time: "present",
    resolution: cellSpan,
  };
  const framed = {
    ...source,
    scope,
    world: { ...source.world, areas: { ...source.world.areas, [area.id]: area } },
  };
  return {
    source: framed,
    ownedGeography: ownsMapGeography(source.world, area.id),
    frame: {
      scope: {
        world: scope.worldId,
        area: area.id,
        areaName: area.name,
        space: scope.spaceId,
        worldGeography: area.profile === "world",
        ownsMapGeography: ownsMapGeography(source.world, area.id),
        areaParents: areaParents(source),
        domain: source.world.reference.domain,
        domainBounds,
        footprint: area.footprint,
        cylindrical: cylinder,
        hasBoundary: !!area.boundary,
        precision: source.world.reference.precision ?? spatial.precision,
        generationDomains: Object.fromEntries(
          Object.values(source.world.layers)
            .filter((layer) => layer.generator)
            .map((layer) => [layer.id, layer.generator])
        ),
        contracted: crossingFeatures(source),
      },
      chart: chartFootprint(interior, bounds, coordinateWidth ?? undefined),
      bounds,
      quality: input.quality,
      profile: area.profile,
      hasParent: !!area.parentId,
      childResolution: area.parentId ? cellSpan : null,
      coordinateWidth,
      boundaryMode: mapBoundaryValue(source.world.reference.boundaryMode),
    },
  };
}
function areaParents(source: DomainSnapshot) {
  return Object.fromEntries(
    Object.values(source.world.areas).map((area) => [area.id, area.parentId])
  );
}
export function crossingFeatures(source: DomainSnapshot) {
  return [
    ...new Set(
      Object.values(source.world.areas).flatMap(
        (area) => area.boundary?.crossings.map((crossing) => crossing.featureId) ?? []
      )
    ),
  ];
}
