import type { MapDescriptor, SavedMapDocument } from "@atlas/map";
import type { PublishedPresentation } from "./PublishedMapView";
import { publishedDrawnStyles, vectorFamily } from "./publishedAppearance";
import { initialPublishedPresentation } from "./publishedStyling";
import { realScaleStyles } from "./realScale";
import type { LayerStyle } from "./types";
import type { PublishedTool } from "./publishedInteractions";

/** The workspace chrome the viewer has set up: what the map shows, the open panel and the tool. */
export interface Chrome {
  presentation: PublishedPresentation;
  panel: string;
  tool: PublishedTool;
}
/** Holds the chrome of the map being viewed for the map opened next. */
export interface ViewedChrome {
  read(): Chrome | null;
  write(value: Chrome): void;
}
export function viewedChrome(): ViewedChrome {
  let held: Chrome | null = null;
  return {
    read: () => held,
    write: (value) => {
      held = value;
    },
  };
}
/**
 * Moving between maps in a session carries the viewer's layer choices; a map opened with
 * nothing viewed before it (a fresh load) uses its saved view, else its defaults.
 */
export function startingPresentation(
  map: MapDescriptor,
  saved: SavedMapDocument | undefined,
  previous: PublishedPresentation | null
): PublishedPresentation {
  if (previous) return carriedPresentation(previous, map);
  const stored =
    saved?.reference.revision === map.reference.revision
      ? (saved.settings.presentation as unknown as PublishedPresentation)
      : undefined;
  return stored ?? initialPublishedPresentation(map);
}
/** The previous style of each layer this map shares with it; layers it lacks keep their defaults. */
function carryStyles(defaults: LayerStyle[], previous: LayerStyle[] | null): LayerStyle[] {
  return defaults.map((style) => {
    const same = previous?.find((old) => vectorFamily(old.layerId) === vectorFamily(style.layerId));
    return same ? { ...same, layerId: style.layerId } : style;
  });
}
/**
 * Opening another map keeps what the viewer chose to show: layer visibility and styling,
 * raster base and fields, and the drawing mode. Layers and fields the new map does not have
 * fall back to its defaults; per-feature overrides, the sheet title, the footprint and the
 * region ancestry belong to the map they were set on.
 */
export function carriedPresentation(
  previous: PublishedPresentation,
  map: MapDescriptor
): PublishedPresentation {
  const fresh = initialPublishedPresentation(map);
  const layers = new Set(map.layers.map((layer) => layer.id));
  const has = (channel: string) => layers.has(channel) || layers.has(`raster:${channel}`);
  const drawn = previous.drawing.mode === "drawn";
  let defaults = fresh.styles;
  if (drawn) {
    defaults = publishedDrawnStyles(map, previous.drawing.subject);
    if (map.realScale) defaults = realScaleStyles(defaults);
  }
  return {
    ...fresh,
    styles: carryStyles(defaults, previous.styles),
    rasterStyles: previous.rasterStyles && carryStyles(fresh.styles, previous.rasterStyles),
    raster: { ...previous.raster, fields: previous.raster.fields.filter((f) => has(f.channel)) },
    drawing: {
      ...previous.drawing,
      fields: previous.drawing.fields.filter(has),
      overrides: {},
      sheet: {
        ...previous.drawing.sheet,
        title: fresh.drawing.sheet.title,
        subtitle: fresh.drawing.sheet.subtitle,
      },
    },
    ...(map.realScale ? { realScale: previous.realScale ?? fresh.realScale } : {}),
  };
}
