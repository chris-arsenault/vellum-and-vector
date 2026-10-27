import type { World } from "@atlas/domain";

export function worldMetadata(world: World) {
  const {
    areas,
    features,
    entities,
    templates,
    connections,
    networkNodes,
    networkReaches,
    societies,
    drainage,
    ...metadata
  } = world;
  void [
    areas,
    features,
    entities,
    templates,
    connections,
    networkNodes,
    networkReaches,
    societies,
    drainage,
  ];
  return { ...metadata, fields: [], magic: [], landmarks: [], views: [] };
}
