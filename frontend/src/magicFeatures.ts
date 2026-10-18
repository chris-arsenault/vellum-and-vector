import { areaSpace, spatial } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { AtlasFeature, World } from "./types";

export function magicFeatures(world: World, areaId: string, footprint: Geometry): AtlasFeature[] {
  return world.magic.flatMap((source) => {
    const geometry: Geometry = { type: "Point", coordinates: [source.source.x, source.source.y] };
    const owner = source.areaId ?? Object.values(world.areas).find((area) => !area.parentId)!.id;
    if (
      areaSpace(world, owner) !== areaSpace(world, areaId) ||
      !spatial.intersects(geometry, footprint)
    )
      return [];
    return [
      {
        id: source.id,
        areaId: owner,
        layerId: "magic",
        kind: "magicSource",
        name: source.name,
        geometry,
        detail: {},
        attributes: { effect: source.effect, radius: source.radius },
        relations: [],
        state: "authored",
        actor: "user",
        protected: true,
        generationId: null,
        causes: [],
      },
    ];
  });
}
