import { Circle, Fill, Stroke, Style, Text } from "ol/style.js";
import GeoJSON from "ol/format/GeoJSON.js";
import type OLGeometry from "ol/geom/Geometry.js";
import type { StyleLike } from "ol/style/Style.js";
import type { Geometry } from "geojson";
import type { MapDescriptor } from "@atlas/map";
import type { PublishedFeature } from "./publishedAppearance";
import { isHexLayer, type RealScalePresentation } from "./realScale";
import type { LayerStyle } from "./types";

/** Colours of the hex fill view and of each real-scale kind's ground. */
export const markColours: Record<string, string> = {
  water: "#5f9fc4",
  way: "#b89a6a",
  plot: "#cfc88a",
  structure: "#9a7458",
  object: "#5e5446",
  cave: "#6e5d4b",
};
const kindMark: Record<string, string> = {
  caves: "cave",
  caveEntrances: "cave",
  rivers: "water",
  lakes: "water",
  oceans: "water",
  waterworks: "water",
  roads: "way",
  plots: "plot",
  structures: "structure",
  ruins: "structure",
  objects: "object",
};
const shapes = new WeakMap<object, OLGeometry>();
function footprintGeometry(footprint: unknown) {
  let shape = shapes.get(footprint as object);
  if (!shape) {
    shape = new GeoJSON().readGeometry(footprint as Geometry)!;
    shapes.set(footprint as object, shape);
  }
  return shape;
}
/** Proper names label the map; a part named only by its kind (a passage, a chamber) does not. */
function label(feature: PublishedFeature, resolution: number) {
  if (!feature.name || resolution > 2 || feature.attributes.nameStatus === "label")
    return undefined;
  return new Text({
    text: feature.name,
    font: "12px serif",
    fill: new Fill({ color: "#2b2620" }),
    stroke: new Stroke({ color: "#fffaf0", width: 3 }),
    overflow: true,
  });
}
/** Ground class labels to the published surface legend's colours. */
export function groundColours(map: MapDescriptor): ReadonlyMap<string, string> {
  const layer = map.layers.find((entry) => entry.id === "raster:finalSurface");
  if (layer?.source.kind !== "raster") return new Map();
  return new Map(
    (layer.source.data.bands[0]?.categories ?? []).flatMap((category) =>
      category.color ? [[category.label, category.color] as const] : []
    )
  );
}
/** In the fill view a hex takes the colour of what covers it, else of its ground class. */
function hexStyle(
  feature: PublishedFeature,
  view: RealScalePresentation,
  grounds: ReadonlyMap<string, string>
) {
  const { fill: mark, ground } = feature.attributes;
  const colour =
    (typeof mark === "string" && markColours[mark]) ||
    (typeof ground === "string" && grounds.get(ground)) ||
    undefined;
  const fill = view.hexView === "fill" && colour ? new Fill({ color: colour }) : undefined;
  return new Style({ fill, stroke: new Stroke({ color: "#3a3a3a55", width: 1 }) });
}
/** A point, such as a cave entrance, draws as a small ringed dot. */
function pointStyle(
  feature: PublishedFeature,
  colour: string,
  resolution: number,
  base: LayerStyle
) {
  return new Style({
    image: new Circle({
      radius: 5,
      fill: new Fill({ color: colour }),
      stroke: new Stroke({ color: "#fffaf0", width: 2 }),
    }),
    text: base.labels ? label(feature, resolution) : undefined,
  });
}
/** Lines that state their width draw the ground they cover, with their course on top. */
function groundStyles(
  feature: PublishedFeature,
  colour: string,
  resolution: number,
  base: LayerStyle
) {
  if (feature.geometry.type === "Point") return [pointStyle(feature, colour, resolution, base)];
  const styles: Style[] = [];
  if (feature.footprint)
    styles.push(
      new Style({
        geometry: footprintGeometry(feature.footprint),
        fill: new Fill({ color: colour }),
        stroke: new Stroke({ color: "#00000033", width: 1 }),
      })
    );
  const line = feature.geometry.type.includes("Line");
  styles.push(
    new Style({
      stroke: line
        ? new Stroke({ color: feature.footprint ? "#ffffff66" : colour, width: 2 })
        : undefined,
      fill: line ? undefined : new Fill({ color: colour }),
      text: base.labels ? label(feature, resolution) : undefined,
    })
  );
  if (!line) styles[styles.length - 1].setStroke(new Stroke({ color: "#2b2620", width: 1 }));
  return styles;
}
/** Real-scale presentation of one feature; hidden creator layers draw nothing. A feature that
 * names no creator layer belongs to the map's first one. */
export function realScaleStyle(
  base: LayerStyle,
  view: RealScalePresentation,
  firstLayer: string,
  grounds: ReadonlyMap<string, string> = new Map()
): StyleLike {
  return (feature, resolution) => {
    const domain = feature.get("domain") as PublishedFeature;
    const named = domain.attributes.creatorLayer;
    const layer = typeof named === "string" ? named : firstLayer;
    if (isHexLayer(domain.layerId)) return hexStyle(domain, view, grounds);
    if (view.hidden.includes(layer)) return [];
    const colour =
      base.color && !kindMark[domain.layerId] ? base.color : markColours[kindMark[domain.layerId]];
    return groundStyles(domain, colour ?? "#777777", resolution, base);
  };
}
