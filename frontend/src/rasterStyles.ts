import type { ExpressionValue as Expr } from "ol/expr/expression.js";
import type { Style } from "ol/layer/WebGLTile.js";
import type { FieldStyle, RasterPresentation } from "./types";
import { palettes, scaledValue } from "./rasterPresentation";
import { biomes, type SurfaceCategory } from "@atlas/domain";
import { contourScale, terrainContours } from "./terrainContours";

const band = (index: number, x = 0, y = 0): Expr => ["band", index, x, y];
const variable = (name: string): Expr => ["var", name];
const mask: Expr = [">", band(2), 0.99];
/** Terrain band order after `terrainTile`: see `terrainSampleBands`. */
const terrainBand = { relative: 3, water: 4, ice: 5, surface: 7, natural: 8, east: 10, north: 11 };
type ClassColor = Pick<SurfaceCategory, "code" | "color">;
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
  classes: ClassColor[] | null = style.channel === "biome"
    ? biomes.map((biome, code) => ({ code, color: biome.color }))
    : null
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
function surfaced(base: Expr, classes: SurfaceCategory[]): Expr {
  const painted = classes.filter((c) => !c.bathymetric);
  if (!painted.length) return base;
  const natural = classMatch(
    band(terrainBand.natural),
    painted.filter((c) => !c.system),
    base
  );
  const code = band(terrainBand.surface);
  let colored = classMatch(code, painted, natural);
  const tinted = painted.filter((c) => c.tint < 1);
  if (tinted.length) {
    const weight: Expr = ["match", ["round", code], ...tinted.flatMap((c) => [c.code, c.tint]), 1];
    colored = ["interpolate", ["linear"], weight, 0, natural, 1, colored];
  }
  return ["case", [">", variable("surface"), 0], colored, base];
}
export function terrainStyle(view: RasterPresentation, classes: SurfaceCategory[] = []): Style {
  const { slope, light } = gradients();
  const water = band(terrainBand.water);
  const sea = ramp(band(terrainBand.relative), ["#6f9dab", "#b6d4d7"], -6000, 0);
  const color: Expr = [
    "case",
    [">", water, 1.5],
    "#a1c8ce",
    [">", water, 0.5],
    surfaced(sea, classes),
    surfaced(landColor(), classes),
  ];
  const ice: Expr = ["clamp", ["*", band(terrainBand.ice), 1.5], 0, 1];
  return {
    variables: terrainVariables(view),
    brightness: ["-", ["*", 0.55, light], 0.4],
    color: [
      "case",
      mask,
      terrainContours(["interpolate", ["linear"], ice, 0, color, 1, "#e2ede8"], slope),
      ["color", 0, 0, 0, 0],
    ],
  };
}
