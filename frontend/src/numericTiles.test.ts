import { expect, it } from "vitest";
import { createGrid, putChannel, rectangle } from "@atlas/domain";
import { numericTileSampler } from "./numericTiles";
import { defaultFieldStyle, fieldRange, legendValue, scaledValue } from "./rasterPresentation";
import { terrainStyle, overlayStyle } from "./rasterStyles";
import { defaultRasterPresentation } from "./rasterPresentation";
import { newCompilationContext, buildExpression } from "ol/expr/gpu.js";
import { ColorType, NumberType, newParsingContext } from "ol/expr/expression.js";
import type { Raster } from "./types";

function fixture(channel = "temperature"): Raster {
  const field = createGrid(
    "numeric",
    {
      worldId: "world",
      areaId: "area",
      spaceId: "surface",
      crsId: "metres",
      footprint: rectangle([0, 0, 100, 100]),
      time: "present",
      revision: 1,
      resolution: 25,
    },
    5,
    5
  );
  putChannel(
    field,
    channel,
    "metre",
    Float64Array.from({ length: 25 }, (_, i) => (i % 5) - 2)
  );
  return {
    id: field.id,
    areaId: "area",
    field,
    channel,
    footprint: field.scope.footprint,
    bounds: field.bounds,
  };
}
it("retains zero, negative values and their logarithms while masking absent coverage", () => {
  const raster = fixture(),
    sample = numericTileSampler(raster);
  expect([...sample([49, 49, 51, 51], 1)]).toEqual([0, 1, 0]);
  const negative = sample([24, 49, 26, 51], 1);
  expect(negative[0]).toBe(-1);
  expect(negative[1]).toBe(1);
  expect(negative[2]).toBeCloseTo(-Math.log(2));
  expect([...sample([-20, -20, -10, -10], 1)]).toEqual([0, 0, 0]);
  raster.field.channels.temperature.fill(NaN);
  expect([...numericTileSampler(raster)([49, 49, 51, 51], 1)]).toEqual([0, 0, 0]);
  raster.field.channels.temperature.fill(25);
  raster.field.active.fill(0);
  expect([...numericTileSampler(raster)([49, 49, 51, 51], 1)]).toEqual([0, 0, 0]);
});
it("samples adjacent numerical tiles identically to a combined view", () => {
  const sample = numericTileSampler(fixture());
  const whole = sample([0, 0, 100, 100], 16);
  const tile = sample([50, 50, 100, 100], 8);
  for (let row = 0; row < 8; row++)
    expect(tile.slice(row * 8 * 3, (row + 1) * 8 * 3)).toEqual(
      whole.slice((row * 16 + 8) * 3, (row * 16 + 16) * 3)
    );
});
it("preserves authored patches, physical sea level, lakes and emergent islands", () => {
  const raster = fixture("elevation");
  raster.field.channels.elevation.fill(100);
  raster.water = { ...raster.field, channels: { seaLevel: new Float64Array(25).fill(200) } };
  raster.lakes = [{ geometry: rectangle([20, 20, 80, 80]), level: 300 }];
  expect([...numericTileSampler(raster)([29, 29, 31, 31], 1)]).toEqual([100, 1, -100, 2, 0, 2]);
  const patch = fixture("elevation").field;
  patch.scope = { ...patch.scope, footprint: rectangle([45, 45, 55, 55]) };
  patch.channels.elevation.fill(400);
  raster.field.overlays = [{ grid: patch, channels: ["elevation"] }];
  expect([...numericTileSampler(raster)([49, 49, 51, 51], 1)]).toEqual([400, 1, 200, 0, 0, 2]);
});
it("uses actual data ranges and an invertible signed log legend", () => {
  const raster = fixture();
  raster.field.channels.temperature.fill(25);
  const style = defaultFieldStyle("temperature");
  expect(fieldRange([raster], style)).toEqual([25, 26]);
  expect(legendValue(0.5, [0, 99], "log")).toBeCloseTo(9);
  for (const value of [-99, 0, 99])
    expect(scaledValue(value, "log")).toBeCloseTo(Math.sign(value) * Math.log1p(Math.abs(value)));
});
it("compiles terrain and overlay expressions using the real OpenLayers expression parser", () => {
  const styles = [
    terrainStyle(defaultRasterPresentation()),
    overlayStyle(defaultFieldStyle("temperature"), [-10, 30]),
    overlayStyle({ ...defaultFieldStyle("temperature"), scale: "log" }, [-10, 30]),
  ];
  for (const style of styles) {
    expect(
      buildExpression(
        style.color!,
        ColorType,
        newParsingContext(style.variables),
        newCompilationContext(style.variables)
      )
    ).toContain("vec4");
    if (style.brightness)
      expect(
        buildExpression(
          style.brightness,
          NumberType,
          newParsingContext(style.variables),
          newCompilationContext(style.variables)
        )
      ).toContain("clamp");
  }
});
