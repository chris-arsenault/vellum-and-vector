import { v5 } from "uuid";

export function semanticId(worldId: string, kind: string, key: string): string {
  return v5(JSON.stringify([kind, key]), worldId);
}

export function representationId(worldId: string, featureId: string, areaId: string): string {
  return semanticId(worldId, "representation", JSON.stringify([featureId, areaId]));
}
