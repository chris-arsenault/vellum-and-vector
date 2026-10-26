import { createMap, fitArea, updateFeatures } from "./mapEngine";
import { updateDrawnMap, type DrawnMapInput } from "./drawnMap";
import { drawingGeography } from "./drawnGeography";

// Render the designed sheet at native pixel density, rather than enlarging a screenshot.
export const sheetDesignWidth = 1200;
export async function renderDrawnSheet(
  input: DrawnMapInput,
  width: number,
  height: number
): Promise<Blob> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    throw new Error("Choose positive whole-pixel sheet dimensions.");
  await document.fonts.ready;
  const ratio = width / sheetDesignWidth;
  const size = [sheetDesignWidth, height / ratio];
  const target = document.createElement("div");
  target.className = "cartographic-export-surface";
  target.style.width = `${size[0]}px`;
  target.style.height = `${size[1]}px`;
  document.body.append(target);
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
async function composeCanvas(
  target: HTMLElement,
  width: number,
  height: number,
  ratio: number
): Promise<Blob> {
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const ctx = output.getContext("2d");
  if (!ctx) throw new Error("The browser could not create the sheet canvas.");
  ctx.fillStyle = "#eee4c9";
  ctx.fillRect(0, 0, width, height);
  for (const canvas of target.querySelectorAll<HTMLCanvasElement>(".ol-layers canvas")) {
    if (!canvas.width) continue;
    const matrix = new DOMMatrix(canvas.style.transform);
    const opacity = canvas.parentElement?.style.opacity || "1";
    ctx.globalAlpha = Number(opacity);
    ctx.setTransform(
      matrix.a * ratio,
      matrix.b * ratio,
      matrix.c * ratio,
      matrix.d * ratio,
      matrix.e * ratio,
      matrix.f * ratio
    );
    ctx.drawImage(canvas, 0, 0);
  }
  return new Promise((resolve, reject) =>
    output.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The browser could not encode this sheet. Try smaller dimensions."));
    }, "image/png")
  );
}
export async function downloadDrawnSheet(input: DrawnMapInput, width: number, height: number) {
  const blob = await renderDrawnSheet(input, width, height);
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = `${input.view.sheet.title || input.region?.name || input.area.name}.png`;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
