import type RenderEvent from "ol/render/Event.js";
import { regionLineage } from "@atlas/domain";
import type { DrawnMapInput } from "./drawnMap";
import { drawnLegend, type DrawnLegendEntry } from "./drawnLegend";

type PaperContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
const ink = "#53452f",
  paper = "#eee4c9";
export function drawSheet(event: RenderEvent, input: DrawnMapInput) {
  const ctx = event.context;
  if (!ctx || !("fillText" in ctx) || !event.frameState || !event.inversePixelTransform) return;
  const [width, height] = event.frameState.size;
  const matrix = event.inversePixelTransform;
  ctx.save();
  ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  if (input.view.sheet.frame) frame(ctx, width, height);
  title(ctx, input, width);
  if (input.view.sheet.compass) compass(ctx, width - 56, 104);
  if (input.view.sheet.legend) legend(ctx, input, width, height);
  if (input.view.sheet.scale) scale(ctx, event.frameState.viewState.resolution, width, height);
  ctx.restore();
}
function frame(ctx: PaperContext, width: number, height: number) {
  ctx.lineWidth = 1.4;
  ctx.strokeRect(16, 16, width - 32, height - 32);
  ctx.lineWidth = 0.6;
  ctx.strokeRect(21, 21, width - 42, height - 42);
  for (const [x, y] of [
    [16, 16],
    [width - 16, 16],
    [16, height - 16],
    [width - 16, height - 16],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
function title(ctx: PaperContext, input: DrawnMapInput, width: number) {
  const name = input.view.sheet.title || input.region?.name || input.area.name;
  const path = regionLineage(input.world, input.region?.id ?? null)
    .slice(0, -1)
    .map((r) => r.name)
    .join(" · ");
  const subtitle = input.view.sheet.subtitle || path;
  ctx.font = "600 27px Georgia, serif";
  ctx.textAlign = "center";
  const titleWidth = Math.min(width - 80, ctx.measureText(name).width + 44);
  ctx.fillStyle = paper + "ed";
  ctx.fillRect((width - titleWidth) / 2, 26, titleWidth, subtitle ? 63 : 43);
  ctx.fillStyle = ink;
  ctx.fillText(name, width / 2, 56, width - 100);
  if (subtitle) {
    ctx.font = "italic 12px Georgia, serif";
    ctx.fillText(subtitle, width / 2, 77, width - 100);
  }
}
function compass(ctx: PaperContext, x: number, y: number) {
  ctx.fillStyle = paper + "dd";
  ctx.beginPath();
  ctx.arc(x, y, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(x, y - 23);
  ctx.lineTo(x + 7, y + 16);
  ctx.lineTo(x, y + 10);
  ctx.lineTo(x - 7, y + 16);
  ctx.closePath();
  ctx.fill();
  ctx.font = "600 13px Georgia, serif";
  ctx.textAlign = "center";
  ctx.fillText("N", x, y - 31);
}
function legend(ctx: PaperContext, input: DrawnMapInput, width: number, height: number) {
  const entries = drawnLegend(input);
  if (!entries.length) return;
  const columns = Math.max(1, Math.floor((width - 100) / 250));
  const rows = Math.ceil(entries.length / columns),
    blockHeight = rows * 18 + 22;
  const y = height - blockHeight - 45;
  ctx.fillStyle = paper + "ed";
  ctx.fillRect(34, y, width - 68, blockHeight);
  ctx.font = "11px Georgia, serif";
  ctx.textAlign = "left";
  entries.forEach((entry, index) => {
    const column = Math.floor(index / rows),
      row = index % rows;
    const x = 45 + (column * (width - 90)) / columns,
      top = y + 15 + row * 18;
    legendMark(ctx, entry, x, top, input.view.style === "ink");
    ctx.fillStyle = ink;
    ctx.fillText(entry.name, x + 24, top + 2, (width - 100) / columns - 32);
  });
}
function legendMark(
  ctx: PaperContext,
  entry: DrawnLegendEntry,
  x: number,
  y: number,
  monochrome: boolean
) {
  ctx.save();
  ctx.fillStyle = monochrome ? ink : entry.color;
  ctx.strokeStyle = ctx.fillStyle;
  if (entry.mark === "wash") {
    ctx.globalAlpha = 0.7;
    ctx.fillRect(x, y - 8, 16, 10);
  } else if (entry.mark === "dot") {
    ctx.beginPath();
    ctx.arc(x + 8, y - 3, 3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.lineWidth = 1.2;
    if (entry.mark === "dash") ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 16, entry.mark === "hatch" ? y - 9 : y);
    ctx.stroke();
  }
  ctx.restore();
}
function scale(ctx: PaperContext, resolution: number, width: number, height: number) {
  const target = 110 * resolution,
    power = 10 ** Math.floor(Math.log10(target));
  const distance = [1, 2, 5, 10].map((n) => n * power).find((n) => n >= target) ?? power;
  const length = distance / resolution,
    x = width - length - 42,
    y = height - 34;
  ctx.fillStyle = paper + "ed";
  ctx.fillRect(x - 8, y - 18, length + 16, 25);
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 1);
  ctx.lineTo(x + length, y + 1);
  ctx.lineTo(x + length, y - 4);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.font = "10px Georgia, serif";
  ctx.fillText(distance >= 1000 ? `${distance / 1000} km` : `${distance} m`, x + length / 2, y - 7);
}
