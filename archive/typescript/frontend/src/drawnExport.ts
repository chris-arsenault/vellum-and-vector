import { createMap, fitArea, updateFeatures } from "./mapEngine";
import { updateDrawnMap, type DrawnMapInput } from "./drawnMap";
import { drawingGeography } from "./drawnGeography";
import { sheetSurface, composeCanvas, downloadSheet } from "./sheetExportCanvas";
export { sheetDesignWidth } from "./sheetExportCanvas";

// Render the designed sheet at native pixel density, rather than enlarging a screenshot.
export async function renderDrawnSheet(
  input: DrawnMapInput,
  width: number,
  height: number
): Promise<Blob> {
  const { ratio, size, target } = await sheetSurface(width, height);
  const engine = createMap(target, input.world.reference, ratio);
  try {
    engine.map.setSize(size);
    updateFeatures(
      engine,
      input.world,
      input.area,
      input.styles,
      input.features,
      input.view,
      input.region?.footprint ?? input.area.footprint,
      drawingGeography(input.features, input.base)
    );
    updateDrawnMap(engine, input);
    fitArea(engine, { footprint: input.region?.footprint ?? input.area.footprint });
    await new Promise<void>((resolve) => {
      engine.map.once("rendercomplete", () => resolve());
      engine.map.renderSync();
    });
    return await composeCanvas(target, width, height, ratio);
  } finally {
    engine.map.setTarget(undefined);
    engine.map.getAllLayers().forEach((layer) => layer.dispose());
    engine.map.dispose();
    target.remove();
  }
}
export async function downloadDrawnSheet(input: DrawnMapInput, width: number, height: number) {
  const blob = await renderDrawnSheet(input, width, height);
  downloadSheet(blob, input.view.sheet.title || input.region?.name || input.area.name);
}
