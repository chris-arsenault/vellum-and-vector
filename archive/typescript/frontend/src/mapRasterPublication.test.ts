import { expect, it } from "vitest";
import { MapScale } from "@atlas/domain";
import { rasterPublicationInput, mapRasterRows } from "./mapRasterPublication";
import { publishedMapFixture } from "./testSupport/publishedMapFixture";

it("publishes physical shores, display height, slope and named surface metadata", async () => {
  const { world, raster } = publishedMapFixture();
  const input = rasterPublicationInput(world, raster);
  expect(input.grid).toEqual({ width: 8, height: 8, bounds: [0, 0, 100, 100] });
  const stripes = [];
  for await (const stripe of mapRasterRows(raster, input)) stripes.push(stripe);
  const data = stripes[0],
    bands = input.planes.length + 1;
  const at = 4 * bands; // North row, x=56.25 and y=93.75.
  expect(data[at]).toBeCloseTo(MapScale.native(1131.25));
  expect(data[at + 7]).toBeCloseTo(1131.25);
  expect(data[at + 8]).toBeCloseTo(10);
  expect(data[at + 2]).toBe(0);
  expect(data[2]).toBe(1); // Physical ocean mask survives positive elevation.
  expect(data[at + bands - 1]).toBe(1);
  const log = input.planes.findIndex((plane) => plane.band.id === "log-value");
  expect(data[at + log]).toBeCloseTo(Math.log1p(MapScale.native(1131.25)));
  const surface = input.planes.find((plane) => plane.band.id === "surface")!;
  expect(surface.resampling).toBe("category");
  expect(surface.band.categories.some((category) => category.label === "Boreal forest")).toBe(true);
  expect(
    surface.band.categories.filter((category) => category.present).map((category) => category.label)
  ).toEqual(["Boreal forest"]);
  expect(surface.band.categories.some((category) => !category.present)).toBe(true);
});
it("cancels publication before emitting a stripe", async () => {
  const { world, raster } = publishedMapFixture();
  const input = rasterPublicationInput(world, raster);
  const abort = new AbortController();
  abort.abort();
  await expect(mapRasterRows(raster, input, abort.signal).next()).rejects.toThrow();
});
