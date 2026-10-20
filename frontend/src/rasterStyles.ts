import type { ExpressionValue as Expr } from "ol/expr/expression.js";
import type { Style } from "ol/layer/WebGLTile.js";
import type { FieldStyle, RasterPresentation } from "./types";
import { palettes, scaledValue } from "./rasterPresentation";
import { biomes } from "@atlas/domain";

const band = (index: number, x = 0, y = 0): Expr => ["band", index, x, y];
const variable = (name: string): Expr => ["var", name];
const mask: Expr = [">", band(2), 0.99];
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
export function overlayStyle(style: FieldStyle, range: number[]): Style {
  const value: Expr = band(style.scale === "linear" ? 1 : 3);
  return {
    variables: overlayVariables(style, range),
    color: [
      "case",
      mask,
      style.channel === "biome"
        ? [
            "match",
            ["round", band(1)],
            ...biomes.flatMap((biome, code) => [code, biome.color]),
            "#d1c8ae",
          ]
        : ramp(value, palettes[style.palette], variable("minimum"), variable("maximum")),
      ["color", 0, 0, 0, 0],
    ],
  };
}
export function terrainVariables(view: RasterPresentation) {
  return {
    azimuth: (view.sunAzimuth * Math.PI) / 180,
    altitude: (view.sunElevation * Math.PI) / 180,
    exaggeration: view.exaggeration,
    interval: view.contourInterval,
    topo: Number(view.base === "topographic"),
  };
}
function slopeAt(x: number, y: number): Expr {
  return ["case", [">", band(2, x, y), 0.99], band(1, x, y), band(1)];
}
function gradients(): { east: Expr; north: Expr; slope: Expr; light: Expr } {
  const step: Expr = ["*", 2, band(6)];
  const east: Expr = [
    "*",
    variable("exaggeration"),
    ["/", ["-", slopeAt(1, 0), slopeAt(-1, 0)], step],
  ];
  const north: Expr = [
    "*",
    variable("exaggeration"),
    ["/", ["-", slopeAt(0, -1), slopeAt(0, 1)], step],
  ];
  const slope: Expr = ["sqrt", ["+", ["*", east, east], ["*", north, north]]];
  const facing: Expr = [
    "+",
    ["*", east, ["sin", variable("azimuth")]],
    ["*", north, ["cos", variable("azimuth")]],
  ];
  const dot: Expr = [
    "-",
    ["sin", variable("altitude")],
    ["*", ["cos", variable("altitude")], facing],
  ];
  const light: Expr = ["clamp", ["/", dot, ["sqrt", ["+", 1, ["*", slope, slope]]]], 0, 1];
  return { east, north, slope, light };
}
function landColor(slope: Expr): Expr {
  const distance: Expr = [
    "abs",
    ["-", band(1), ["*", variable("interval"), ["round", ["/", band(1), variable("interval")]]]],
  ];
  const contour: Expr = [
    "all",
    [">", variable("topo"), 0],
    [">", slope, 0.0001],
    [">", variable("interval"), ["*", 5, slope, ["resolution"]]],
    ["<", distance, ["*", 0.65, slope, ["resolution"]]],
  ];
  return [
    "case",
    contour,
    "#78664d",
    [">", variable("topo"), 0],
    ramp(band(3), palettes.terrain, 0, 4000),
    "#d1c8ae",
  ];
}
export function terrainStyle(view: RasterPresentation): Style {
  const { slope, light } = gradients();
  const color: Expr = [
    "case",
    [">", band(4), 1.5],
    "#498b99",
    [">", band(4), 0.5],
    ramp(band(3), ["#173b5c", "#43929e"], -6000, 0),
    landColor(slope),
  ];
  const ice: Expr = ["clamp", ["*", band(5), 1.5], 0, 1];
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
