import { areaCatalogue } from "../area/catalogue";
import type { GenerationState, MapProcessContext } from "../process";
import { extractFaults } from "./geologicalFeatures";
import { extractLakes } from "./geographicRegions";
import { publishKinds } from "../poi/poiPublish";
import type { PoiEntry } from "../poi/poiContract";
import { oceanFootprint } from "./geographicContours";
import { extractRanges } from "./reliefFeatures";
import { extractOceans } from "./oceanFeatures";
import { dropClaimedFeatures, extractLandmarks, landmarkClaims } from "./landmarkFeatures";

export interface GeographicDeliveries {
  oceans: boolean;
  impacts: boolean;
  volcanism: boolean;
  fractures: boolean;
  lakes: boolean;
  landforms: boolean;
  ecology: boolean;
  rivers: boolean;
  landmarks: boolean;
}
const allDeliveries: GeographicDeliveries = {
  oceans: true,
  impacts: true,
  volcanism: true,
  fractures: true,
  lakes: true,
  landforms: true,
  ecology: true,
  rivers: true,
  landmarks: true,
};
/** Whether the run's selected features deliver what a kind's places are read from. */
function delivered(entry: PoiEntry, deliveries: GeographicDeliveries) {
  if (entry.group === "cover" || entry.id === "wetland") return deliveries.ecology;
  if (entry.id === "lake") return deliveries.lakes;
  if (entry.id === "volcano" || entry.id === "caldera") return deliveries.volcanism;
  return deliveries.landforms;
}
function publishRiverArea(state: GenerationState, context: MapProcessContext) {
  const publish = areaCatalogue.river.publication.publish;
  if (typeof publish === "function") publish(state, context);
}
export function extractNativeGeography(
  state: GenerationState,
  context: MapProcessContext,
  deliveries = allDeliveries
) {
  context.progress(0, "Tracing ocean shoreline");
  state.surface.ocean = oceanFootprint(state);
  context.progress(0.1, "Extracting ocean regions");
  if (deliveries.oceans) extractOceans(state);
  context.progress(0.2, "Extracting geological events and lakes");
  if (deliveries.fractures) extractFaults(state);
  if (deliveries.lakes) extractLakes(state);
  context.progress(0.35, "Extracting landforms");
  if (deliveries.landforms) extractRanges(state);
  context.progress(0.5, "Publishing the map's places");
  publishKinds(state, "geography", (entry) => delivered(entry, deliveries));
  context.progress(0.8, "Extracting river geography");
  if (deliveries.rivers) publishRiverArea(state, context);
  else delete state.domain.world.drainage?.[state.domain.scope.areaId];
  // Last: a detected landform on a landmark is the landmark, published once under its identity.
  if (deliveries.landmarks) {
    dropClaimedFeatures(state, landmarkClaims(state));
    extractLandmarks(state);
  }
  context.progress(1, "Geographic extraction complete");
}
