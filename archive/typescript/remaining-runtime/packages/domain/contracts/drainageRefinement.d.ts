import type { Area, AtlasFeature } from "./model";
import type { DomainSnapshot } from "./operations";
/** Materialize retained minor channels before fixing the child's crossings. */
export declare function refinedDrainageFeatures(
  snapshot: DomainSnapshot,
  area: Area
): AtlasFeature[];
