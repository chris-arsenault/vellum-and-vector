import type { MapRef, MapRegistryRequest, MapRegistryPage } from "@atlas/map";
import type { MapCatalog } from "./mapCatalog";
import { mapCall } from "./mapCall";
export class MapRegistry {
  constructor(private maps: MapCatalog) {}
  read(reference: MapRef, request: MapRegistryRequest): MapRegistryPage {
    return mapCall(this.maps.rust, "registry", { reference, request });
  }
}
