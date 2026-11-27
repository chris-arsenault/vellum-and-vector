import { unByKey } from "ol/Observable.js";
import type { EventsKey } from "ol/events.js";
import type { Geometry } from "geojson";
import type { Bounds, MapDescriptor, MapEntity, MapFeature, MapReader } from "@atlas/map";
import { terrainBands, terrainLayerId } from "@atlas/map";
import type { CartographicPresentation, LayerStyle } from "./types";
import type { RasterPresentation } from "./types";
import type { RealScalePresentation } from "./realScale";
import type { PublishedMapEngine } from "./publishedMapEngine";
import { publishedScene, publishedStreetScene } from "./publishedScene";
import { PublishedSamples } from "./PublishedSamples";
import {
  publishedDrawingContent,
  publishedDrawingMarks,
  type PublishedDrawing,
} from "./publishedIllustrationData";
import { updatePublishedDrawing } from "./publishedDrawing";
import { bounds } from "./presentation";
import { prepareDrawingGeometry } from "./drawingGeometry";

const noDrawing = {
  features: [],
  oceans: [],
  coastEchoes: [],
  mask: null,
  terrain: [],
  fields: [],
};

export interface PublishedPresentation {
  styles: LayerStyle[];
  rasterStyles: LayerStyle[] | null;
  raster: RasterPresentation;
  drawing: CartographicPresentation;
  footprint: Geometry;
  ancestry: string[];
  /** Present on real-scale maps (ADR 0016). */
  realScale?: RealScalePresentation;
}
interface Scene {
  bounds: Bounds;
  layers: string[];
  features: MapFeature[];
  drawingEntities?: MapEntity[];
}
/** One map revision and one reader own a viewer; a failed read never changes execution host. */
export class PublishedMapView {
  private readonly samples: PublishedSamples;
  private readonly movement: EventsKey;
  private readonly lifetime = new AbortController();
  private request: AbortController | undefined;
  private presentation: PublishedPresentation | undefined;
  private scene: Scene | undefined;
  private rasterPresentation: RasterPresentation | undefined;
  private received: MapDescriptor | undefined;
  constructor(
    readonly engine: PublishedMapEngine,
    private readonly reader: MapReader,
    private readonly report: {
      busy(value: boolean): void;
      error(error: Error): void;
      streetDetail?(): void;
    }
  ) {
    this.samples = new PublishedSamples(reader, engine.descriptor);
    this.movement = engine.map.on("moveend", () => {
      if (this.presentation?.drawing.mode === "raster") void this.update(this.presentation);
    });
  }
  /** Appended GIS layers share this revision's immutable assets and existing viewport. */
  receive(descriptor: MapDescriptor) {
    if (this.received === descriptor) return;
    this.received = descriptor;
    const visible = new Set([
      terrainLayerId,
      ...(this.presentation?.raster.fields
        .filter((field) => field.visible)
        .map((field) => field.channel) ?? []),
    ]);
    if (
      descriptor.layers.some(
        (layer) =>
          visible.has(layer.id) &&
          !this.engine.descriptor.layers.some((held) => held.id === layer.id)
      )
    )
      this.rasterPresentation = undefined;
    Object.assign(this.engine.descriptor, descriptor);
    this.scene = undefined;
  }
  /** An authored map rewrote its terrain raster in place: read it again and redraw. */
  async reloadTerrain() {
    this.engine.rasters.reloadTerrain();
    this.rasterPresentation = undefined;
    await this.samples.forget();
    if (this.presentation) await this.update(this.presentation);
  }
  /** The terrain height in metres at a map position, or null off the raster. */
  async elevationAt(x: number, y: number, signal?: AbortSignal): Promise<number | null> {
    const layer = this.engine.descriptor.layers.find((entry) => entry.id === terrainLayerId);
    if (!layer) return null;
    const [window] = await this.samples.read(
      layer,
      [terrainBands[0]],
      [x - 1, y - 1, x + 1, y + 1],
      2,
      {
        signal,
      }
    );
    return window?.covers({ x, y }) ? window.at(terrainBands[0], { x, y }) : null;
  }
  async update(presentation: PublishedPresentation) {
    this.presentation = presentation;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    const signal = AbortSignal.any([request.signal, this.lifetime.signal]);
    this.report.busy(true);
    try {
      await this.render(presentation, signal);
    } catch (error) {
      if (!signal.aborted)
        this.report.error(error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (this.request === request) this.report.busy(false);
    }
  }
  /** Render one complete presentation; exports receive read errors directly. */
  async render(presentation: PublishedPresentation, signal: AbortSignal) {
    const drawn = presentation.drawing.mode === "drawn";
    const extent = (
      drawn
        ? bounds(presentation.footprint)
        : this.engine.map.getView().calculateExtent(this.engine.map.getSize())
    ) as Bounds;
    const layers = presentation.styles
      .filter((style) => drawn || style.visible)
      .map((style) => style.layerId);
    const input: PublishedDrawing = {
      map: this.engine.descriptor,
      features: [],
      entities: [],
      styles: presentation.styles,
      view: presentation.drawing,
      footprint: presentation.footprint,
      ancestry: presentation.ancestry,
      realScale: presentation.realScale,
    };
    if (!drawn) {
      this.engine.scale.setUnits(presentation.realScale?.units === "feet" ? "imperial" : "metric");
      const preview =
        input.map.realScale?.kind === "ground" && this.engine.space.id === input.map.primarySpaceId
          ? async (features: MapFeature[]) => {
              await updatePublishedDrawing(this.engine, { ...input, features }, noDrawing, true);
              if (!signal.aborted) this.report.streetDetail?.();
            }
          : undefined;
      const [scene] = await Promise.all([
        this.readScene(extent, layers, signal, preview),
        this.updateRaster(presentation.raster, signal),
      ]);
      signal.throwIfAborted();
      await updatePublishedDrawing(this.engine, { ...input, features: scene.features }, noDrawing);
      return;
    }
    const scene = await this.readScene(extent, layers, signal);
    input.features = scene.features;
    input.entities = await this.drawingEntities(scene, signal);
    signal.throwIfAborted();
    const geometry = await prepareDrawingGeometry(this.reader, input, { signal });
    signal.throwIfAborted();
    const content = publishedDrawingContent(input, geometry);
    const marks = await publishedDrawingMarks(input, content, this.samples, this.reader, {
      signal,
    });
    signal.throwIfAborted();
    await updatePublishedDrawing(this.engine, input, { ...geometry, ...marks });
  }
  private async updateRaster(raster: RasterPresentation, signal: AbortSignal) {
    if (this.rasterPresentation === raster) return;
    await this.engine.rasters.update(raster);
    if (!signal.aborted) this.rasterPresentation = raster;
  }
  private async readScene(
    extent: Bounds,
    layers: string[],
    signal: AbortSignal,
    preview?: (features: MapFeature[]) => Promise<void>
  ) {
    const held = this.scene;
    if (
      held &&
      same(held.layers, layers) &&
      (same(held.bounds, extent) || (preview && contains(held.bounds, extent)))
    )
      return held;
    const { descriptor, space } = this.engine;
    const features = preview
      ? await publishedStreetScene(
          this.reader,
          descriptor,
          space.id,
          extent,
          layers,
          signal,
          preview
        )
      : await publishedScene(this.reader, descriptor, space.id, extent, layers, { signal });
    signal.throwIfAborted();
    this.scene = { bounds: extent, layers, features };
    return this.scene;
  }
  private async drawingEntities(scene: Scene, signal: AbortSignal) {
    if (scene.drawingEntities) return scene.drawingEntities;
    const ids = [
      ...new Set(
        scene.features.flatMap((feature) => [
          feature.entityId ?? feature.id,
          ...feature.relations.map((relation) => relation.targetId),
        ])
      ),
    ];
    const entities = ids.length
      ? await this.reader.entities(this.engine.descriptor.reference, ids, { signal })
      : [];
    signal.throwIfAborted();
    scene.drawingEntities = entities;
    return entities;
  }
  async close() {
    unByKey(this.movement);
    this.lifetime.abort();
    this.request?.abort();
    this.engine.close();
    await this.samples.close();
  }
}
const same = <T>(a: T[], b: T[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);
const contains = (outer: Bounds, inner: Bounds) =>
  outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
