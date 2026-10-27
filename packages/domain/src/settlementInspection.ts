import type { AtlasFeature } from "./model";
import type { SocietyRegion } from "./society";

/** Retained society records relevant to one settlement and its geographic links. */
export interface SettlementInspection {
  region: SocietyRegion;
  related: AtlasFeature[];
}
