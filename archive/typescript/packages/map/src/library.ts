import type { MapDescriptor, MapNavigationState } from "./generated";
import type { SaveMapRequest, SavedMapDocument } from "./services";

/** A save captures presentation alongside immutable geography, without copying raster bytes. */
export function savedMapDocument(
  map: MapDescriptor,
  navigation: MapNavigationState,
  request: SaveMapRequest,
  previousVersion: number | null,
  savedAt: string
): SavedMapDocument {
  if (map.state !== "complete") throw new Error("Complete the map before saving it.");
  if (previousVersion !== request.expectedVersion)
    throw new Error("The saved map changed. Reopen it before saving.");
  if (navigation.version !== request.navigationVersion)
    throw new Error("Map regions or views changed. Reload before saving.");
  return {
    reference: map.reference,
    name: map.name,
    savedAt,
    version: (previousVersion ?? 0) + 1,
    navigation,
    settings: request.settings,
  };
}
