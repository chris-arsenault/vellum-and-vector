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
  wall: "#3b3029",
  rock: "#8d877c",
};
/** Single plants and stones draw in their own colours rather than the objects layer's. */
const objectColours: Record<string, string> = {
  tree: "#3f6b3a",
  shrub: "#6d8a4a",
  reeds: "#93a35c",
  boulder: "#8a8580",
  fountain: "#508eaa",
  statue: "#686669",
};
const roofPalette = new Map([
  ["residential", "#ab6e58"],
  ["civic", "#587689"],
  ["economic", "#bc883a"],
]);
const publicSurfaces = new Map<unknown, string>([
  ["paving", "#d9cbaf"],
  ["grass", "#95ad77"],
]);
// owner-direction(2026-11-18): colour house roofs by residential, civic and economic function.
export function roofColour(buildingFunction: unknown): string | undefined {
  return typeof buildingFunction === "string" ? roofPalette.get(buildingFunction) : undefined;
}
const kindMark: Record<string, string> = {
  caves: "cave",
  caveWalls: "wall",
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
  const line = feature.geometry.type.includes("Line");
  return new Text({
    text: feature.name,
    font: "12px serif",
    fill: new Fill({ color: "#2b2620" }),
    stroke: new Stroke({ color: "#fffaf0", width: 3 }),
    placement: line ? "line" : "point",
    overflow: false,
    padding: [2, 4, 2, 4],
  });
}
/** Ground class labels to the published surface legend's colours. */
/** Colours of the map's published hex classes: ground classes by id, and cover classes by
 * id under a `cover:` prefix, as the map's authoring choices state them. */
export function groundColours(map: MapDescriptor): ReadonlyMap<string, string> {
  const choices = map.realScale?.authoring;
  const entries = [
    ...(choices?.groundClasses ?? []).map((entry) => [entry.id, entry.color] as const),
    ...(choices?.coverClasses ?? []).map((entry) => [`cover:${entry.id}`, entry.color] as const),
  ];
  return new Map(entries.flatMap(([id, color]) => (color ? [[id, color] as const] : [])));
}
/** In the fill view a hex takes the colour of what covers it, else of its ground class, with
 * its cover class as a tint over it. */
function hexStyle(
  feature: PublishedFeature,
  view: RealScalePresentation,
  grounds: ReadonlyMap<string, string>
) {
  const { fill: mark, ground, cover } = feature.attributes;
  const colour =
    (typeof mark === "string" && markColours[mark]) ||
    (typeof ground === "string" && grounds.get(ground)) ||
    undefined;
  const filled = view.hexView === "fill";
  const fill = filled && colour ? new Fill({ color: colour }) : undefined;
  const outline = new Style({ fill, stroke: new Stroke({ color: "#3a3a3a55", width: 1 }) });
  const tint = typeof cover === "string" ? grounds.get(`cover:${cover}`) : undefined;
  return filled && tint ? [outline, new Style({ fill: new Fill({ color: tint }) })] : outline;
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
function courseStroke(feature: PublishedFeature, colour: string) {
  if (!feature.geometry.type.includes("Line")) return undefined;
  // A constant screen-width centreline would obscure narrow lanes and passages at town scale.
  if (feature.layerId === "roads" && feature.footprint) return undefined;
  return new Stroke({ color: feature.footprint ? "#ffffff66" : colour, width: 2 });
}
/** A measured road draws the ground its carriageway covers. */
function pointStyles(
  feature: PublishedFeature,
  colour: string,
  resolution: number,
  base: LayerStyle
) {
  const marker = pointStyle(feature, colour, resolution, base);
  if (feature.kind !== "majorWork" || !feature.footprint) return [marker];
  return [
    new Style({
      geometry: footprintGeometry(feature.footprint),
      stroke: new Stroke({ color: "#81672b", width: 2 }),
    }),
    marker,
  ];
}
function groundStyles(
  feature: PublishedFeature,
  colour: string,
  resolution: number,
  base: LayerStyle
) {
  if (feature.geometry.type === "Point") return pointStyles(feature, colour, resolution, base);
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
  const floors = feature.attributes.storeys;
  if (feature.kind === "building" && typeof floors === "number" && floors > 1) {
    const shadow = footprintGeometry(feature.geometry).clone();
    shadow.translate(floors * 0.85, -floors * 0.85);
    styles.push(
      new Style({ geometry: shadow, fill: new Fill({ color: "#42362766" }), zIndex: -1 })
    );
  }
  styles.push(
    new Style({
      stroke: courseStroke(feature, colour),
      fill: line ? undefined : new Fill({ color: colour }),
      text: base.labels ? label(feature, resolution) : undefined,
    })
  );
  if (!line) styles[styles.length - 1].setStroke(new Stroke({ color: "#2b2620", width: 1 }));
  return styles;
}
function featureColour(domain: PublishedFeature, base: LayerStyle) {
  if (domain.layerId === "plots")
    return publicSurfaces.get(domain.attributes.publicSurface) ?? markColours.plot;
  if (domain.kind === "building" && domain.layerId === "structures")
    return roofColour(domain.attributes.buildingFunction) ?? markColours.structure;
  if (domain.layerId === "objects") return objectColours[domain.kind] ?? markColours.object;
  return markColours[kindMark[domain.layerId]] ?? base.color ?? "#777777";
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
    return groundStyles(domain, featureColour(domain, base), resolution, base);
  };
}
