import LayerGroup from "ol/layer/Group.js";
import type Projection from "ol/proj/Projection.js";
import type { MapDescriptor, MapLayer, MapReader } from "@atlas/map";
import { terrainLayerId } from "@atlas/map";
import { publishedRaster, publishedStyle } from "./publishedRaster";
import { configureTerrainContours } from "./terrainContours";
import type { FieldStyle, RasterPresentation } from "./types";

/** Immutable map assets stay open across appearance changes; only visible overlays are fetched. */
export class PublishedMapLayers {
  readonly base = new LayerGroup();
  readonly overlays = new LayerGroup();
  readonly layers = new Map<string, ReturnType<typeof publishedRaster>>();
  private readonly loading = new Map<string, Promise<ReturnType<typeof publishedRaster>>>();
  private sequence = 0;
  private readonly abort = new AbortController();
  constructor(
    private readonly reader: MapReader,
    private readonly descriptor: MapDescriptor,
    private readonly projection: Projection,
    private readonly spaceId = descriptor.primarySpaceId
  ) {}

  async update(presentation: RasterPresentation) {
    const sequence = ++this.sequence;
    const enabled = new Map(
      presentation.fields.filter((field) => field.visible).map((field) => [field.channel, field])
    );
    const wanted = this.descriptor.layers.filter(
      (layer) =>
        layer.spaceId === this.spaceId &&
        layer.source.kind === "raster" &&
        (layer.id === terrainLayerId || enabled.has(layer.id))
    );
    const requests = wanted.flatMap((layer) => {
      const field = enabled.get(layer.id);
      return layer.id === terrainLayerId
        ? [{ layer, field: undefined }, ...(field ? [{ layer, field }] : [])]
        : [{ layer, field }];
    });
    const ready = await Promise.all(
      requests.map(async ({ layer, field }) => ({
        layer,
        field,
        raster: await this.open(layer, presentation, field),
      }))
    );
    if (sequence !== this.sequence || this.abort.signal.aborted) return;
    for (const [id, layer] of this.layers)
      layer.setVisible(requests.some((item) => layerKey(item.layer, item.field) === id));
    for (const { layer, raster, field } of ready) {
      applyRasterStyle(layer, raster, presentation, field);
    }
    this.overlays.getLayers().clear();
    for (const field of presentation.fields) {
      const layer = this.layers.get(
        field.channel === terrainLayerId ? elevationOverlayKey : field.channel
      );
      if (field.visible && layer) this.overlays.getLayers().push(layer);
    }
  }
  private open(layer: MapLayer, presentation: RasterPresentation, field?: FieldStyle) {
    const key = layerKey(layer, field);
    const held = this.layers.get(key);
    if (held) return Promise.resolve(held);
    const loading = this.loading.get(key);
    if (loading) return loading;
    if (layer.source.kind !== "raster") throw new Error("Expected a map raster.");
    const promise = this.reader
      .source(this.descriptor.reference, layer.source.data.assetId, { signal: this.abort.signal })
      .then((source) => {
        this.abort.signal.throwIfAborted();
        const raster = publishedRaster(layer, source, this.projection, presentation, field);
        this.layers.set(key, raster);
        if (layer.id === terrainLayerId && !field) this.base.getLayers().push(raster);
        return raster;
      })
      .finally(() => this.loading.delete(key));
    this.loading.set(key, promise);
    return promise;
  }
  close() {
    this.abort.abort();
    for (const layer of this.layers.values()) {
      layer.getSource()?.dispose();
      layer.dispose();
    }
    this.layers.clear();
    this.base.getLayers().clear();
    this.overlays.getLayers().clear();
  }
}
function applyRasterStyle(
  layer: MapLayer,
  raster: ReturnType<typeof publishedRaster>,
  presentation: RasterPresentation,
  field?: FieldStyle
) {
  if (layer.source.kind !== "raster") return;
  const terrain = layer.id === terrainLayerId && !field;
  raster.setStyle(publishedStyle(layer.source.data, terrain, presentation, field));
  raster.setOpacity(terrain ? 1 : field!.opacity);
  raster.setVisible(true);
  if (terrain) configureTerrainContours(raster, presentation.contourInterval);
}
const elevationOverlayKey = "overlay:terrain";
const layerKey = (layer: MapLayer, field?: FieldStyle) =>
  layer.id === terrainLayerId && field ? elevationOverlayKey : layer.id;
