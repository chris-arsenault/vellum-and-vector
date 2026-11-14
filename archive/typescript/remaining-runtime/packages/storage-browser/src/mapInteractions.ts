import type {
  Inspection,
  InspectionRequest,
  MapRef,
  RegionSelection,
  SelectionRequest,
} from "@atlas/map";
import type { MapCatalog } from "./mapCatalog";
import { mapCall } from "./mapCall";
export class MapInteractions {
  constructor(private maps: MapCatalog) {}
  inspect(reference: MapRef, request: InspectionRequest): Inspection {
    return mapCall(this.maps.rust, "inspect", { reference, request });
  }
  selectRegion(reference: MapRef, request: SelectionRequest): RegionSelection {
    return mapCall(this.maps.rust, "selectRegion", { reference, request });
  }
}
