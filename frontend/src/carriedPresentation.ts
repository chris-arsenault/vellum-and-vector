import type { MapDescriptor, SavedMapDocument } from "@atlas/map";
import type { PublishedPresentation } from "./PublishedMapView";
import { publishedDrawnStyles, vectorFamily } from "./publishedAppearance";
import { initialPublishedPresentation } from "./publishedStyling";
import { realScaleStyles } from "./realScale";
import type { LayerStyle } from "./types";
import type { PublishedTool } from "./publishedInteractions";
import { mapPresentationLevel } from "./cityPresentation";

/** The workspace chrome the viewer has set up: what the map shows, the open panel and the tool. */
export interface Chrome {
  presentation: PublishedPresentation;
  panel: string;
  tool: PublishedTool;
}
type LayerChoices = Map<string, Partial<Pick<LayerStyle, "visible" | "labels">>>;
/** Holds the chrome of the map being viewed for the map opened next. */
export interface ViewedChrome {
  read():
    (Chrome & { choices: LayerChoices; level: ReturnType<typeof mapPresentationLevel> }) | null;
  write(map: MapDescriptor, value: Chrome): void;
}
export function viewedChrome(): ViewedChrome {
  let held: Chrome | null = null;
  let revision: string | undefined;
  let level: ReturnType<typeof mapPresentationLevel> = "region";
  const choices: LayerChoices = new Map();
  return {
    read: () => held && { ...held, choices, level },
    write: (map, value) => {
      const { styles, drawing } = value.presentation;
      const sameMap = revision === map.reference.revision;
      if (!held || (sameMap && held.presentation.styles !== styles)) {
        const sameMode =
          held?.presentation.drawing.mode === drawing.mode &&
          held.presentation.drawing.subject === drawing.subject;
        const baseline = sameMode ? held!.presentation.styles : defaultStyles(map, drawing);
        rememberLayerChanges(choices, baseline, styles);
      }
      revision = map.reference.revision;
      if (!sameMap) level = mapPresentationLevel(map);
      held = value;
    },
  };
}
function rememberLayerChanges(choices: LayerChoices, before: LayerStyle[], after: LayerStyle[]) {
  for (const style of after) {
    const prior = before.find((entry) => entry.layerId === style.layerId);
    if (!prior) continue;
    const id = vectorFamily(style.layerId);
    for (const key of ["visible", "labels"] as const) {
      if (prior[key] !== style[key]) choices.set(id, { ...choices.get(id), [key]: style[key] });
    }
  }
}
function defaultStyles(map: MapDescriptor, drawing: PublishedPresentation["drawing"]) {
  if (drawing.mode !== "drawn") return initialPublishedPresentation(map).styles;
  const styles = publishedDrawnStyles(map, drawing.subject);
  return map.realScale ? realScaleStyles(styles, map) : styles;
}
/**
 * Moving between maps in a session carries the viewer's layer choices; a map opened with
 * nothing viewed before it (a fresh load) uses its saved view, else its defaults.
 */
export function startingPresentation(
  map: MapDescriptor,
  saved: SavedMapDocument | undefined,
  previous: ReturnType<ViewedChrome["read"]>
): PublishedPresentation {
  if (previous) return carriedPresentation(previous, map);
  const stored =
    saved?.reference.revision === map.reference.revision
      ? (saved.settings.presentation as unknown as PublishedPresentation)
      : undefined;
  return stored ?? initialPublishedPresentation(map);
}
/** The previous style of each layer this map shares with it; layers it lacks keep their defaults. */
function carryStyles(
  defaults: LayerStyle[],
  previous: LayerStyle[] | null,
  choices?: LayerChoices
): LayerStyle[] {
  return defaults.map((style) => {
    const id = vectorFamily(style.layerId);
    const same = previous?.find((old) => vectorFamily(old.layerId) === id);
    if (!same) return style;
    // City and Street draw different layers by default. Carry the viewer's
    // explicit choices when crossing that boundary.
    const display = choices && { visible: style.visible, labels: style.labels, ...choices.get(id) };
    return { ...same, layerId: style.layerId, ...display };
  });
}
/**
 * Opening another map keeps what the viewer chose to show: layer visibility and styling,
 * raster base and fields, and the drawing mode. Layers and fields the new map does not have
 * fall back to its defaults; per-feature overrides, the sheet title, the footprint and the
 * region ancestry belong to the map they were set on.
 */
export function carriedPresentation(
  chrome: NonNullable<ReturnType<ViewedChrome["read"]>>,
  map: MapDescriptor
): PublishedPresentation {
  const previous = chrome.presentation;
  const fresh = initialPublishedPresentation(map);
  const layers = new Set(map.layers.map((layer) => layer.id));
  const has = (channel: string) => layers.has(channel) || layers.has(`raster:${channel}`);
  const drawn = previous.drawing.mode === "drawn";
  const defaults = drawn ? defaultStyles(map, previous.drawing) : fresh.styles;
  const crossScale = mapPresentationLevel(map) !== chrome.level ? chrome.choices : undefined;
  return {
    ...fresh,
    styles: carryStyles(defaults, previous.styles, crossScale),
    rasterStyles:
      previous.rasterStyles && carryStyles(fresh.styles, previous.rasterStyles, crossScale),
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
