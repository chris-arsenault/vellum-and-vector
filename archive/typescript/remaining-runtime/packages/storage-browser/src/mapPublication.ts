import type { Database } from "./catalogDatabase";
import type { GeometryKernel } from "./geometryKernel";
import type {
  MapDescriptor,
  MapLayer,
  MapRef,
  MapPublicationBatch,
  PublishedAsset,
} from "@atlas/map";
import { rustMapStore } from "./rustMapStore";
import { mapCall } from "./mapCall";
/** Publication and transaction rules execute in Rust. */
export class MapPublication {
  private rust;
  constructor(db: Database, kernel: GeometryKernel) {
    this.rust = rustMapStore(db, kernel);
  }
  begin(map: MapDescriptor, expected: MapRef | null, progressive: boolean): void {
    mapCall(this.rust, "begin", { map, expected, progressive });
  }
  append(reference: MapRef, batch: MapPublicationBatch): void {
    mapCall(this.rust, "append", { reference, batch });
  }
  addLayer(reference: MapRef, layer: MapLayer, asset: PublishedAsset): void {
    mapCall(this.rust, "addLayer", { reference, layer, asset });
  }
  finish(reference: MapRef): void {
    mapCall(this.rust, "finish", { reference });
  }
  discard(reference: MapRef): void {
    mapCall(this.rust, "discard", { reference });
  }
}
