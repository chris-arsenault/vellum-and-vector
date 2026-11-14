import type { Geometry } from "geojson";
import type { AtlasFeature } from "./model";
import type { DomainSnapshot } from "./operations";
import type { Value } from "./schemas";
export declare function featureAttributes(
  snapshot: DomainSnapshot,
  previous: AtlasFeature | undefined,
  areaId: string,
  geometry: Geometry,
  input: Record<string, unknown>
): Record<string, Value>;
