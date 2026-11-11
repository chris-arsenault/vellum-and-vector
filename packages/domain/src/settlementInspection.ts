import type { AtlasFeature } from "./model";

/**
 * What stands beside one settlement on the map: the places its ways lead to, the works and
 * events recorded at it, and the territories of the realm it holds with. The settlement's own
 * record says the rest.
 */
export interface SettlementInspection {
  related: AtlasFeature[];
}
