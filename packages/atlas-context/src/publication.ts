import type {
  MapDescriptor,
  MapRef,
  MapLayer,
  MapPublicationBatch,
  PublishedAsset,
} from "@atlas/map";

type Completion = void | Promise<void>;

/** Generation-host publication. This capability is never supplied to the map viewer. */
export interface MapPublisher {
  begin(map: MapDescriptor, expected: MapRef | null, progressive: boolean): Completion;
  append(reference: MapRef, batch: MapPublicationBatch): Completion;
  addLayer(reference: MapRef, layer: MapLayer, asset: PublishedAsset): Completion;
  finish(reference: MapRef): Completion;
  discard(reference: MapRef): Completion;
}
