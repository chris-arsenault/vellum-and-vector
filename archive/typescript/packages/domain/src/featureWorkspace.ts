import type { AtlasFeature, World } from "./model";

export interface FeatureSelection {
  areaId?: string;
  layerId?: string;
  kind?: string;
}
/** Private execution records. Reads return values; changes become authoritative only through put. */
export interface FeatureReader {
  get(id: string): AtlasFeature | undefined;
  values(selection?: FeatureSelection): Iterable<AtlasFeature>;
}
export interface FeatureWorkspace extends FeatureReader {
  put(feature: AtlasFeature): void;
  remove(id: string): void;
  revisions(): Iterable<[string, number]>;
}
/** Only following relationships contribute geometry to a feature's composed presentation. */
export function featureWorkspaceWorld(
  world: World,
  workspace: FeatureReader,
  ids: Iterable<string>
): World {
  const features: Record<string, AtlasFeature> = {},
    pending = [...ids];
  const visited = new Set<string>();
  for (const id of pending) {
    if (visited.has(id)) continue;
    visited.add(id);
    const feature = workspace.get(id);
    if (!feature) continue;
    features[id] = feature;
    for (const relation of feature.relations)
      if (relation.kind === "follows") pending.push(relation.targetId);
  }
  return { ...world, features };
}
