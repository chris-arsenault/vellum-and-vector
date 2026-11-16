import { unByKey } from "ol/Observable.js";
import type { EventsKey } from "ol/events.js";
import type { Geometry } from "geojson";
import type { Bounds, MapDescriptor, MapEntity, MapFeature, MapReader } from "@atlas/map";
import { terrainLayerId } from "@atlas/map";
import type { CartographicPresentation, LayerStyle } from "./types";
import type { RasterPresentation } from "./types";
import type { RealScalePresentation } from "./realScale";
import type { PublishedMapEngine } from "./publishedMapEngine";
import { publishedScene } from "./publishedScene";
import { PublishedSamples } from "./PublishedSamples";
import {
  publishedDrawingContent,
  publishedDrawingMarks,
  type PublishedDrawing,
} from "./publishedIllustrationData";
import { updatePublishedDrawing } from "./publishedDrawing";
import { bounds } from "./presentation";
import { prepareDrawingGeometry } from "./drawingGeometry";

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
  entities: MapEntity[];
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
    private readonly report: { busy(value: boolean): void; error(error: Error): void }
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
    const scene = await this.readScene(extent, layers, signal);
    signal.throwIfAborted();
    const input: PublishedDrawing = {
      map: this.engine.descriptor,
      features: scene.features,
      entities: scene.entities,
      styles: presentation.styles,
      view: presentation.drawing,
      footprint: presentation.footprint,
      ancestry: presentation.ancestry,
      realScale: presentation.realScale,
    };
    if (!drawn) {
      this.engine.scale.setUnits(presentation.realScale?.units === "feet" ? "imperial" : "metric");
      if (this.rasterPresentation !== presentation.raster) {
        await this.engine.rasters.update(presentation.raster);
        this.rasterPresentation = presentation.raster;
      }
      signal.throwIfAborted();
      await updatePublishedDrawing(this.engine, input, {
        features: [],
        oceans: [],
        coastEchoes: [],
        mask: null,
        terrain: [],
        fields: [],
      });
      return;
    }
    const geometry = await prepareDrawingGeometry(this.reader, input, { signal });
    signal.throwIfAborted();
    const content = publishedDrawingContent(input, geometry);
    const marks = await publishedDrawingMarks(input, content, this.samples, this.reader, {
      signal,
    });
    signal.throwIfAborted();
    await updatePublishedDrawing(this.engine, input, { ...geometry, ...marks });
  }
  private async readScene(extent: Bounds, layers: string[], signal: AbortSignal) {
    const held = this.scene;
    if (held && same(held.bounds, extent) && same(held.layers, layers)) return held;
    const { descriptor, space } = this.engine;
    const features = await publishedScene(this.reader, descriptor, space.id, extent, layers, {
      signal,
    });
    const ids = [
      ...new Set(
        features.flatMap((feature) => [
          feature.entityId ?? feature.id,
          ...feature.relations.map((relation) => relation.targetId),
        ])
      ),
    ];
    const entities = await this.reader.entities(descriptor.reference, ids, { signal });
    signal.throwIfAborted();
    this.scene = { bounds: extent, layers, features, entities };
    return this.scene;
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
