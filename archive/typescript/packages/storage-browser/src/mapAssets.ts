import { BrowserMapRaster, initializeEngine, type RasterPublicationInput } from "@atlas/engine";
import type { IllustrationGeometry, MapFeature, PublishedAsset, RasterSource } from "@atlas/map";
import { blockCacheBudgetBytes } from "./opfsBlockCache";
import { browserMapAssetFiles, type MapAssetFiles } from "./mapAssetFiles";
import { rustMapProductFiles } from "./rustMapProductFiles";

/** Immutable finished-map files. The directory contains no numerical generation resources. */
export class MapAssets {
  constructor(private files: MapAssetFiles) {}
  static async open() {
    return new MapAssets(await browserMapAssetFiles());
  }
  producerFiles() {
    return rustMapProductFiles(this.files);
  }
  async file(location: string) {
    if (!/^[a-zA-Z0-9_-]+\.[a-z]+$/.test(location)) throw new Error("Invalid map asset location.");
    return this.files.file(location);
  }
  async raster(
    input: RasterPublicationInput,
    rows: AsyncIterable<Float32Array>,
    signal?: AbortSignal
  ) {
    await initializeEngine();
    const output = await this.create("tif");
    let scratch: Awaited<ReturnType<MapAssets["create"]>> | undefined;
    let upload: BrowserMapRaster | undefined;
    let consumed = false,
      complete = false;
    try {
      scratch = await this.create("scratch");
      upload = new BrowserMapRaster(JSON.stringify(input), scratch.access, blockCacheBudgetBytes);
      for await (const batch of rows) {
        signal?.throwIfAborted();
        upload.append(batch);
      }
      signal?.throwIfAborted();
      consumed = true;
      const source = JSON.parse(
        await upload.finish(output.access, {
          cancelled: () => signal?.aborted ?? false,
          progress: () => {},
          yieldControl: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
        })
      ) as RasterSource;
      const asset = await this.metadata(input.assetId, output.location, source.mediaType);
      complete = true;
      return { source, asset };
    } finally {
      if (upload && !consumed) upload.free();
      scratch?.access.close();
      output.access.close();
      if (scratch) await this.files.remove(scratch.location);
      if (!complete) await this.files.remove(output.location);
    }
  }
  async vectors(id: string, features: AsyncIterable<MapFeature>, signal?: AbortSignal) {
    return this.collection(id, vectorRecords(features), false, signal);
  }
  async illustration(
    id: string,
    shapes: AsyncIterable<IllustrationGeometry>,
    signal?: AbortSignal
  ) {
    return this.collection(id, illustrationRecords(shapes), true, signal);
  }
  private async collection(
    id: string,
    records: AsyncIterable<unknown>,
    illustration: boolean,
    signal?: AbortSignal
  ) {
    const output = await this.create("geojson");
    let complete = false,
      offset = 0,
      first = true;
    const write = (text: string) => {
      const bytes = new TextEncoder().encode(text);
      let at = 0;
      while (at < bytes.length) {
        const written = output.access.write(bytes.subarray(at), offset + at);
        if (written <= 0) throw new Error("Map asset write did not advance.");
        at += written;
      }
      offset += bytes.length;
    };
    try {
      write('{"type":"FeatureCollection","features":[');
      for await (const record of records) {
        signal?.throwIfAborted();
        write((first ? "" : ",") + JSON.stringify(record));
        first = false;
      }
      signal?.throwIfAborted();
      write("]}");
      output.access.flush();
      output.access.close();
      const asset = await this.metadata(id, output.location, "application/geo+json");
      complete = true;
      return { ...asset, illustration };
    } finally {
      output.access.close();
      if (!complete) await this.files.remove(output.location);
    }
  }
  private async metadata(id: string, location: string, mediaType: string): Promise<PublishedAsset> {
    return {
      id,
      location,
      mediaType,
      byteLength: (await this.file(location)).size,
      illustration: false,
    };
  }
  private async create(extension: string) {
    const location = `${crypto.randomUUID()}.${extension}`;
    try {
      return { location, access: await this.files.create(location) };
    } catch (error) {
      await this.files.remove(location);
      throw error;
    }
  }
}
async function* vectorRecords(features: AsyncIterable<MapFeature>) {
  for await (const feature of features)
    yield {
      type: "Feature",
      id: feature.id,
      geometry: feature.geometry,
      properties: {
        ...feature.attributes,
        name: feature.name,
        layerId: feature.layerId,
        entityId: feature.entityId,
        kind: feature.kind,
        typeId: feature.typeId,
        catalog: feature.catalog,
        footprint: feature.footprint,
        relations: feature.relations,
        causes: feature.causes,
      },
    };
}
async function* illustrationRecords(shapes: AsyncIterable<IllustrationGeometry>) {
  for await (const shape of shapes)
    yield {
      type: "Feature",
      geometry: shape.geometry,
      properties: { featureId: shape.featureId },
    };
}
