import type {
  MapDescriptor,
  MapFeature,
  MapLayer,
  MapPublicationBatch,
  MapRef,
  MapSample,
  HistoryEntry,
  IllustrationGeometry,
  MapEntity,
} from "@atlas/map";
import type { MapPublisher } from "@atlas/context";
import type { MapAssets } from "@atlas/storage-browser/maps";
import type { LoadedRaster, World } from "./types";
import { publishMapRaster } from "./mapRasterPublication";

export interface MapProductHost {
  publication: MapPublisher;
  assets: Pick<MapAssets, "raster" | "vectors" | "illustration">;
}
export interface MapProductInput {
  world: World;
  /** Non-raster layers are declared before their records stream. */
  descriptor: MapDescriptor;
  expected: MapRef | null;
  progressive: boolean;
  rasters: AsyncIterable<LoadedRaster>;
  features(layerId: string): AsyncIterable<MapFeature>;
  samples(layers: MapLayer[]): Iterable<MapSample>;
  history: Iterable<HistoryEntry>;
  entities: Iterable<MapEntity>;
  illustration(): AsyncIterable<IllustrationGeometry>;
}
const publicationBatchSize = 128;

/** Every asset and record belongs to one pending map revision before its head is replaced. */
export async function publishMapProduct(
  host: MapProductHost,
  input: MapProductInput,
  signal?: AbortSignal
) {
  const { publication, assets } = host;
  const map = structuredClone(input.descriptor);
  const ref = map.reference;
  signal?.throwIfAborted();
  await publication.begin(map, input.expected, input.progressive);
  try {
    for await (const raster of input.rasters) {
      signal?.throwIfAborted();
      const product = await publishMapRaster(assets, input.world, raster, signal);
      await publication.addLayer(ref, product.layer, product.asset);
      map.layers.push(product.layer);
    }
    for (const layer of map.layers) {
      if (layer.source.kind !== "vector") continue;
      const records = featureBatches(
        input.features(layer.id),
        (features) => publication.append(ref, { features }),
        signal
      );
      const asset = await assets.vectors(layer.source.data.assetId, records, signal);
      await publication.append(ref, { assets: [asset] });
    }
    await appendBatches(input.samples(map.layers), (samples) => ({ samples }));
    await appendBatches(input.history, (history) => ({ history }));
    await appendBatches(input.entities, (entities) => ({ entities }));
    await publication.append(ref, {
      assets: [await assets.illustration(crypto.randomUUID(), input.illustration(), signal)],
    });
    signal?.throwIfAborted();
    await publication.finish(ref);
    return ref;
  } catch (error) {
    await publication.discard(ref);
    throw error;
  }
  async function appendBatches<T>(
    records: Iterable<T>,
    batch: (records: T[]) => MapPublicationBatch
  ) {
    let pending: T[] = [];
    for (const record of records) {
      signal?.throwIfAborted();
      pending.push(record);
      if (pending.length < publicationBatchSize) continue;
      await publication.append(ref, batch(pending));
      pending = [];
      await yieldControl();
    }
    if (pending.length) await publication.append(ref, batch(pending));
  }
}
async function* featureBatches(
  records: AsyncIterable<MapFeature>,
  append: (features: MapFeature[]) => void | Promise<void>,
  signal?: AbortSignal
) {
  let pending: MapFeature[] = [];
  for await (const feature of records) {
    signal?.throwIfAborted();
    pending.push(feature);
    yield feature;
    if (pending.length < publicationBatchSize) continue;
    await append(pending);
    pending = [];
    await yieldControl();
  }
  if (pending.length) await append(pending);
}
const yieldControl = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
