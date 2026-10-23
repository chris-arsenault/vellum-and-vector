import type { ExpressionValue as Expr } from "ol/expr/expression.js";
import type { Style } from "ol/layer/WebGLTile.js";
import type { FieldStyle, RasterPresentation } from "./types";
import { palettes, scaledValue } from "./rasterPresentation";
import { biomes, type SurfaceCategory } from "@atlas/domain";

const band = (index: number, x = 0, y = 0): Expr => ["band", index, x, y];
const variable = (name: string): Expr => ["var", name];
const mask: Expr = [">", band(2), 0.99];
/** Terrain band order after `terrainTile`: see `terrainSampleBands`. */
const terrainBand = { relative: 3, water: 4, ice: 5, surface: 7, east: 8, north: 9 };
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
    topo: Number(view.base !== "relief"),
    surface: Number(view.base === "surface"),
  };
}
function gradients(): { east: Expr; north: Expr; slope: Expr; light: Expr } {
  const east: Expr = ["*", variable("exaggeration"), band(terrainBand.east)];
  const north: Expr = ["*", variable("exaggeration"), band(terrainBand.north)];
  const slope: Expr = ["sqrt", ["+", ["*", east, east], ["*", north, north]]];
  const facing: Expr = [
    "+",
    ["*", east, variable("azimuthSin")],
    ["*", north, variable("azimuthCos")],
  ];
  const dot: Expr = ["-", variable("altitudeSin"), ["*", variable("altitudeCos"), facing]];
  const light: Expr = ["clamp", ["/", dot, ["sqrt", ["+", 1, ["*", slope, slope]]]], 0, 1];
  return { east, north, slope, light };
}
function contourLine(slope: Expr): Expr {
  const distance: Expr = [
    "abs",
    ["-", band(1), ["*", variable("interval"), ["round", ["/", band(1), variable("interval")]]]],
  ];
  return [
    "all",
    [">", variable("topo"), 0],
    [">", slope, 0.0001],
    [">", variable("interval"), ["*", 5, slope, ["resolution"]]],
    ["<", distance, ["*", 0.65, slope, ["resolution"]]],
  ];
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
 * Surface classes replace the base colour where the class says more than depth or
 * height does; bathymetric water classes keep the depth ramp. Hillshade applies on top.
 */
function surfaced(base: Expr, classes: SurfaceCategory[]): Expr {
  const painted = classes.filter((c) => !c.bathymetric);
  if (!painted.length) return base;
  const code = band(terrainBand.surface);
  let colored = classMatch(code, painted, base);
  const tinted = painted.filter((c) => c.tint < 1);
  if (tinted.length) {
    const weight: Expr = ["match", ["round", code], ...tinted.flatMap((c) => [c.code, c.tint]), 1];
    colored = ["interpolate", ["linear"], weight, 0, base, 1, colored];
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
    contourLine(slope),
    "#92876b",
    surfaced(landColor(), classes),
  ];
  const ice: Expr = ["clamp", ["*", band(terrainBand.ice), 1.5], 0, 1];
  return {
    variables: terrainVariables(view),
    brightness: ["*", ["-", ["*", 0.55, light], 0.4], ["-", 1, ice]],
    color: [
      "case",
      mask,
      ["interpolate", ["linear"], ice, 0, color, 1, "#e2ede8"],
      ["color", 0, 0, 0, 0],
    ],
  };
}
