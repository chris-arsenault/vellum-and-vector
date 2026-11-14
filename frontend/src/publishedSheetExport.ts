import type { MapDescriptor, MapReader } from "@atlas/map";
import { createPublishedMap } from "./publishedMapEngine";
import { PublishedMapView, type PublishedPresentation } from "./PublishedMapView";
import { sheetSurface, composeCanvas, downloadSheet } from "./sheetExportCanvas";

/** Draw at the requested native pixel density using only this immutable map revision. */
export async function renderPublishedSheet(
  map: MapDescriptor,
  reader: MapReader,
  presentation: PublishedPresentation,
  width: number,
  height: number
): Promise<Blob> {
  const { ratio, size, target } = await sheetSurface(width, height);
  const engine = createPublishedMap(target, map, reader, map.primarySpaceId, ratio);
  const viewer = new PublishedMapView(engine, reader, {
    busy: () => {},
    error: (error) => {
      throw error;
    },
  });
  try {
    engine.map.setSize(size);
    await viewer.render(
      { ...presentation, drawing: { ...presentation.drawing, mode: "drawn" } },
      new AbortController().signal
    );
    await new Promise<void>((resolve) => {
      engine.map.once("rendercomplete", () => resolve());
      engine.map.renderSync();
    });
    return await composeCanvas(target, width, height, ratio);
  } finally {
    await viewer.close();
    target.remove();
  }
}
export async function downloadPublishedSheet(
  map: MapDescriptor,
  reader: MapReader,
  presentation: PublishedPresentation,
  width: number,
  height: number
) {
  const blob = await renderPublishedSheet(map, reader, presentation, width, height);
  downloadSheet(blob, presentation.drawing.sheet.title || map.name);
}
