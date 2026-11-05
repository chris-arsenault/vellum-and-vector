import type { AtlasFeature } from "@atlas/domain";
import type { PoiHostLink } from "../poi/poiContract";
import type { GenerationState } from "../process";
import type { RegionalState } from "../regional/state";
import { areaCatalogue } from "./catalogue";
import type { AreaKindId } from "./areaKinds";

/** The link a place at this cell records when it is placed on an area of this kind. */
export function linkOn(state: GenerationState, kind: AreaKindId, cell: number) {
  const linkAt = areaCatalogue[kind].hosting.linkAt;
  return typeof linkAt === "function" ? linkAt(state, cell) : null;
}
/** Where a record that was placed on an area stands on this map, or -1 when that lies off it. */
export function hostedCell(state: GenerationState, feature: AtlasFeature) {
  const link = feature.attributes.hostedBy as PoiHostLink | undefined;
  if (!link || !("regional" in state)) return -1;
  const cellFor = areaCatalogue[link.host].hosting.cellFor;
  return typeof cellFor === "function" ? cellFor(state as RegionalState, link) : -1;
}
