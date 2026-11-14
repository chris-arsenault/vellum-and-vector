import Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";
import LayerGroup from "ol/layer/Group.js";
import VectorLayer from "ol/layer/Vector.js";
import VectorSource from "ol/source/Vector.js";
import type { StyleLike } from "ol/style/Style.js";
import type { Geometry } from "geojson";
import type { MapDescriptor, MapEntity, MapFeature } from "@atlas/map";
import type { DrawingFeature } from "./drawingGeometry";
import type { CartographicPresentation, LayerStyle } from "./types";
import {
  publishedAppearance,
  publishedFeature,
  vectorFamily,
  type PublishedFeature,
} from "./publishedAppearance";
import { settlementPriority } from "./settlementStyles";
import { typeStyle } from "./typeStyles";
import type { DrawingGeography } from "./publishedAppearance";

const format = new GeoJSON();
export class PublishedVectors {
  readonly group = new LayerGroup();
  readonly layers = new Map<string, VectorLayer>();
  private readonly features = new Map<string, Feature>();
  private sequence = 0;
  constructor(
    private readonly descriptor: MapDescriptor,
    private readonly wrapX: boolean
  ) {}

  async update(
    records: MapFeature[],
    entities: MapEntity[],
    styles: LayerStyle[],
    drawing?: {
      view: CartographicPresentation;
      footprint?: Geometry;
      geography?: DrawingGeography;
      features: Map<string, DrawingFeature>;
    }
  ) {
    const sequence = ++this.sequence;
    const scene = records.map(publishedFeature);
    this.syncLayers(styles);
    this.syncFeatures(scene);
    const appearance = publishedAppearance(this.descriptor, entities);
    await Promise.all(
      styles.map(async (style) => {
        const layer = this.layers.get(style.layerId)!;
        const parsed = drawing?.view.mode === "drawn" ? undefined : await symbolStyle(layer, style);
        if (sequence !== this.sequence) return;
        layer.setStyle(
          typeStyle(
            appearance,
            { ...style, layerId: vectorFamily(style.layerId) },
            parsed,
            drawing?.view,
            drawing?.footprint,
            drawing?.geography,
            drawing?.features
          )
        );
      })
    );
  }
  private syncLayers(styles: LayerStyle[]) {
    for (const style of styles) {
      let layer = this.layers.get(style.layerId);
      if (!layer) {
        layer = new VectorLayer({
          source: new VectorSource({ wrapX: this.wrapX }),
          declutter: true,
          renderOrder: (a, b) =>
            settlementPriority(b.get("domain")) - settlementPriority(a.get("domain")),
          properties: {
            mapLayerId: style.layerId,
            title: this.descriptor.layers.find((entry) => entry.id === style.layerId)?.name,
          },
        });
        this.layers.set(style.layerId, layer);
      }
      layer.setVisible(style.visible);
      layer.setOpacity(style.opacity);
      layer.setMinResolution(style.minScale);
    }
    const ordered = styles
      .slice()
      .reverse()
      .map((style) => this.layers.get(style.layerId)!);
    const collection = this.group.getLayers();
    for (const layer of collection.getArray().slice())
      if (!ordered.some((entry) => entry === layer)) collection.remove(layer);
    ordered.forEach((layer, index) => {
      if (collection.item(index) === layer) return;
      collection.remove(layer);
      collection.insertAt(index, layer);
    });
  }
  private syncFeatures(scene: PublishedFeature[]) {
    const wanted = new Set(scene.map((feature) => feature.id));
    for (const [id, feature] of this.features) {
      if (wanted.has(id)) continue;
      const previous = feature.get("domain") as PublishedFeature;
      this.layers.get(previous.mapLayerId)?.getSource()!.removeFeature(feature);
      this.features.delete(id);
    }
    for (const record of scene) this.syncFeature(record);
  }
  private syncFeature(record: PublishedFeature) {
    const source = this.layers.get(record.mapLayerId)?.getSource();
    if (!source) return;
    let feature = this.features.get(record.id);
    if (!feature) {
      feature = new Feature();
      feature.setId(record.id);
      this.features.set(record.id, feature);
    } else {
      const previous = feature.get("domain") as PublishedFeature;
      if (previous.mapLayerId !== record.mapLayerId)
        this.layers.get(previous.mapLayerId)?.getSource()!.removeFeature(feature);
      for (const key of Object.keys(previous.attributes))
        if (!(key in record.attributes)) feature.unset(key);
    }
    feature.setGeometry(format.readGeometry(record.geometry)!);
    feature.setProperties({
      ...record.attributes,
      name: record.name,
      kind: record.kind,
      domain: record,
    });
    if (!source.hasFeature(feature)) source.addFeature(feature);
  }
  close() {
    ++this.sequence;
    for (const layer of this.layers.values()) {
      layer.getSource()?.clear();
      layer.dispose();
    }
    this.layers.clear();
    this.features.clear();
    this.group.getLayers().clear();
  }
}
async function symbolStyle(layer: VectorLayer, style: LayerStyle): Promise<StyleLike | undefined> {
  if (!style.symbols) return undefined;
  if (layer.get("symbols") === style.symbols) return layer.get("parsedStyle");
  const { default: Parser } = await import("geostyler-openlayers-parser");
  const result = await new Parser().writeStyle(style.symbols);
  if (result.errors?.length) throw result.errors[0];
  layer.set("symbols", style.symbols);
  layer.set("parsedStyle", result.output);
  return result.output as StyleLike;
}
