import type { MapRef, MapSettlement } from "@atlas/map";
import type { MapCatalog } from "./mapCatalog";
import { mapCall } from "./mapCall";
export class MapSettlements {
  constructor(private maps: MapCatalog) {}
  read(reference: MapRef, id: string): MapSettlement | null {
    return mapCall(this.maps.rust, "settlement", { reference, id });
  }
}
