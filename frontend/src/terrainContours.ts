import type { ExpressionValue as Expr } from "ol/expr/expression.js";
import type WebGLTile from "ol/layer/WebGLTile.js";

// Cartographic controls in CSS pixels; elevation levels stay anchored at datum zero.
const indexFactor = 5;
const scaleElevationPerPixel = 0.25;
const intermediateHalfWidth = 0.45;
const indexHalfWidth = 0.8;
const featherStart = 2;
const featherEnd = 6;

export function contourScale(minimum: number, resolution: number) {
  const level = Math.max(
    0,
    Math.log(Math.max(1, (resolution * scaleElevationPerPixel) / minimum)) / Math.log(indexFactor)
  );
  const whole = Math.floor(level);
  return { contourStep: minimum * indexFactor ** whole, contourMix: level - whole };
}

/** OpenLayers expressions omit logarithms; update these uniforms for each view scale. */
export function configureTerrainContours(layer: WebGLTile, minimum: number) {
  layer.set("contourMinimum", minimum, true);
  layer.set("contourResolution", NaN, true);
  if (layer.get("contourScaleBound")) return;
  layer.set("contourScaleBound", true, true);
  layer.on("prerender", (event) => {
    const resolution = event.frameState!.viewState.resolution;
    if (layer.get("contourResolution") === resolution) return;
    layer.set("contourResolution", resolution, true);
    layer.updateStyleVariables(contourScale(layer.get("contourMinimum"), resolution));
  });
}

function ink(interval: Expr, rise: Expr, halfWidth: number): Expr {
  const height: Expr = ["band", 9];
  const distance: Expr = [
    "abs",
    ["-", height, ["*", interval, ["round", ["/", height, interval]]]],
  ];
  // One pixel of antialiasing, independent of the terrain's vertical exaggeration.
  return [
    "clamp",
    ["-", halfWidth + 0.5, ["/", distance, ["case", [">", rise, 0.00001], rise, 0.00001]]],
    0,
    1,
  ];
}

function hierarchy(interval: Expr, rise: Expr) {
  const spacing: Expr = ["/", interval, ["case", [">", rise, 0.00001], rise, 0.00001]];
  const feather: Expr = ["interpolate", ["linear"], spacing, featherStart, 0, featherEnd, 1];
  const minor: Expr = ["*", feather, ink(interval, rise, intermediateHalfWidth)];
  const major = ink(["*", indexFactor, interval], rise, indexHalfWidth);
  return { minor, major };
}

/**
 * USGS-style index/intermediate hierarchy with feathered intermediate strokes.
 * Crossfade adjacent nested scale hierarchies so zoom changes never create
 * per-cell holes or move a retained contour to a different elevation.
 */
export function terrainContours(base: Expr, slope: Expr): Expr {
  const interval: Expr = ["var", "contourStep"];
  const rise: Expr = ["*", slope, ["resolution"]];
  const fine = hierarchy(interval, rise),
    coarse = hierarchy(["*", indexFactor, interval], rise);
  const eligible: Expr = [
    "all",
    [">", ["var", "topo"], 0],
    ["<", ["band", 4], 0.5],
    [">", slope, 0.000001],
  ];
  const blend = (a: Expr, b: Expr): Expr => [
    "case",
    eligible,
    ["interpolate", ["linear"], ["var", "contourMix"], 0, a, 1, b],
    0,
  ];
  // Compose stroke coverage before colour so the potentially large surface-class
  // expression is evaluated once, rather than duplicated for each hierarchy.
  return [
    "interpolate",
    ["linear"],
    blend(fine.major, coarse.major),
    0,
    ["interpolate", ["linear"], blend(fine.minor, coarse.minor), 0, base, 1, "#92876b"],
    1,
    "#796d53",
  ];
}
