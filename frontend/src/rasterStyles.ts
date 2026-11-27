import type { ExpressionValue as Expr } from "ol/expr/expression.js";
import type { Style } from "ol/layer/WebGLTile.js";
import type { FieldStyle, RasterPresentation } from "./types";
import { palettes, scaledValue } from "./rasterColors";
import { contourScale, terrainContours } from "./terrainContours";

const band = (index: number, x = 0, y = 0): Expr => ["band", index, x, y];
const variable = (name: string): Expr => ["var", name];
const mask: Expr = [">", band(2), 0.99];
/** Terrain band order after `terrainTile`: see `terrainSampleBands`. */
const terrainBand = { relative: 3, water: 4, ice: 5, east: 10, north: 11 };
/** Ice is a partial tint: the ice band is thickness in kilometres, full tint from 500 m. */
const iceTint = { strength: 0.5, fullThickness: 0.5, color: "#d3e4ec" };
type ClassColor = { code: number; color: string };
function classMatch(value: Expr, classes: ClassColor[], fallback: Expr): Expr {
  if (!classes.length) return fallback;
  return ["match", ["round", value], ...classes.flatMap((c) => [c.code, c.color]), fallback];
}
function ramp(value: Expr, colors: string[], minimum: Expr, maximum: Expr): Expr {
  const t: Expr = [
    "clamp",
    ["/", ["-", value, minimum], ["case", ["==", maximum, minimum], 1, ["-", maximum, minimum]]],
    0,
    1,
  ];
  return [
    "interpolate",
    ["linear"],
    t,
    ...colors.flatMap((color, i) => [i / (colors.length - 1), color]),
  ];
}
export function overlayVariables(style: FieldStyle, range: number[]) {
  return {
    minimum: scaledValue(range[0], style.scale),
    maximum: scaledValue(range[1], style.scale),
  };
}
export function overlayStyle(
  style: FieldStyle,
  range: number[],
  classes: ClassColor[] | null = null
): Style {
  const value: Expr = band(style.scale === "linear" ? 1 : 3);
  return {
    variables: overlayVariables(style, range),
    color: [
      "case",
      mask,
      classes
        ? classMatch(band(1), classes, "#d1c8ae")
        : ramp(value, palettes[style.palette], variable("minimum"), variable("maximum")),
      ["color", 0, 0, 0, 0],
    ],
  };
}
export function terrainVariables(view: RasterPresentation) {
  return {
    azimuthSin: Math.sin((view.sunAzimuth * Math.PI) / 180),
    azimuthCos: Math.cos((view.sunAzimuth * Math.PI) / 180),
    altitudeSin: Math.sin((view.sunElevation * Math.PI) / 180),
    altitudeCos: Math.cos((view.sunElevation * Math.PI) / 180),
    exaggeration: view.exaggeration,
    interval: view.contourInterval,
    ...contourScale(view.contourInterval, 1),
    topo: Number(view.base !== "relief"),
    surface: Number(view.base === "surface"),
  };
}
function gradients(): { slope: Expr; light: Expr } {
  const rawEast = band(terrainBand.east),
    rawNorth = band(terrainBand.north);
  const east: Expr = ["*", variable("exaggeration"), rawEast];
  const north: Expr = ["*", variable("exaggeration"), rawNorth];
  const exaggeratedSlope: Expr = ["sqrt", ["+", ["*", east, east], ["*", north, north]]];
  const slope: Expr = ["sqrt", ["+", ["*", rawEast, rawEast], ["*", rawNorth, rawNorth]]];
  const facing: Expr = [
    "+",
    ["*", east, variable("azimuthSin")],
    ["*", north, variable("azimuthCos")],
  ];
  const dot: Expr = ["-", variable("altitudeSin"), ["*", variable("altitudeCos"), facing]];
  const light: Expr = [
    "clamp",
    ["/", dot, ["sqrt", ["+", 1, ["*", exaggeratedSlope, exaggeratedSlope]]]],
    0,
    1,
  ];
  return { slope, light };
}
function landColor(): Expr {
  return [
    "case",
    [">", variable("topo"), 0],
    ramp(band(terrainBand.relative), palettes.terrain, 0, 4000),
    "#e1ddcd",
  ];
}
/**
 * Magical surface tints sit over natural cover. Bathymetric water classes keep
 * the depth ramp; relief and contours apply after surface and ice colour.
 */
function surfaced(base: Expr): Expr {
  const alpha: Expr = ["clamp", band(16), 0, 1];
  const divisor: Expr = ["case", [">", alpha, 0.000001], alpha, 0.000001];
  const color: Expr = [
    "color",
    ["/", band(13), divisor],
    ["/", band(14), divisor],
    ["/", band(15), divisor],
  ];
  return [
    "case",
    [">", variable("surface"), 0],
    ["interpolate", ["linear"], alpha, 0, base, 1, color],
    base,
  ];
}
/** At Street scale the occupied settlement is the foreground on a Surface basemap. */
export function terrainStyle(view: RasterPresentation, settlement = false): Style {
  const { slope, light } = gradients();
  const water = band(terrainBand.water);
  const streetSurface = settlement && view.base === "surface";
  const land = surfaced(landColor());
  const sea = ramp(band(terrainBand.relative), ["#6f9dab", "#b6d4d7"], -6000, 0);
  const color: Expr = [
    "case",
    [">", water, 1.5],
    "#a1c8ce",
    [">", water, 0.5],
    surfaced(sea),
    streetSurface ? ["interpolate", ["linear"], 0.72, 0, "#f2eedf", 1, land] : land,
  ];
  // owner-direction(2026-11-16): on a topo map, ice fields must not block everything else out
  // Ice tints the terrain beneath, so elevation colour, hillshade and contours stay readable.
  const ice: Expr = [
    "*",
    iceTint.strength,
    ["clamp", ["/", band(terrainBand.ice), iceTint.fullThickness], 0, 1],
  ];
  return {
    variables: terrainVariables(view),
    brightness: [
      "*",
      streetSurface ? ["case", ["<", water, 0.5], 0.24, 1] : 1,
      ["-", ["*", 0.55, light], 0.4],
    ],
    color: [
      "case",
      mask,
      terrainContours(["interpolate", ["linear"], ice, 0, color, 1, iceTint.color], slope),
      ["color", 0, 0, 0, 0],
    ],
  };
}
