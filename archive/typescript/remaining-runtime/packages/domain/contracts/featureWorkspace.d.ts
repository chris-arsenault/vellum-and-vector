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
export declare function featureWorkspaceWorld(
  world: World,
  workspace: FeatureReader,
  ids: Iterable<string>
): World;
