import type { FieldStyle, RasterPresentation } from "./types";
export function defaultRasterPresentation(): RasterPresentation {
  return {
    base: "surface",
    sunAzimuth: 315,
    sunElevation: 45,
    exaggeration: 1,
    contourInterval: 100,
    fields: [],
  };
}
export function defaultFieldStyle(channel: string): FieldStyle {
  return {
    channel,
    visible: true,
    opacity: 0.65,
    palette: "viridis",
    scale: "linear",
    range: null,
  };
}
