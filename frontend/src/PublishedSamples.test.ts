import { expect, it, vi } from "vitest";
import { fromUrl } from "geotiff";
import type { MapReader } from "@atlas/map";
import { descriptor } from "./testSupport/mapProductFixture";
import { PublishedSamples } from "./PublishedSamples";

vi.mock("geotiff", () => ({ fromUrl: vi.fn() }));

it("reads an illustrated overlay's mapped planes from a shared GIS asset", async () => {
  const map = descriptor("grouped");
  const layer = map.layers[1];
  if (layer.source.kind !== "raster") throw new Error("Expected raster fixture");
  const band = layer.source.data.bands[0];
  layer.source.data.bands = [
    { ...band, id: "value" },
    { ...band, id: "coverage" },
  ];
  layer.source.data.bandIndices = [4, 6];
  const planes = [99, 0, 100, 0.75, 200, 1];
  const readRasters = vi.fn(async ({ samples }: { samples: number[] }) =>
    samples.map((index) => new Float32Array([planes[index]]))
  );
  const close = vi.fn();
  vi.mocked(fromUrl).mockResolvedValue({ readRasters, close } as unknown as Awaited<
    ReturnType<typeof fromUrl>
  >);
  const reader = { source: vi.fn(async () => ({ url: "https://fixture.invalid/group.tif" })) };
  const samples = new PublishedSamples(reader as unknown as MapReader, map);
  const [window] = await samples.read(layer, ["value"], map.bounds, 10);
  expect(window.covers({ x: 5, y: 5 })).toBe(true);
  expect(window.at("value", { x: 5, y: 5 })).toBe(0.75);
  await samples.close();
  expect(close).toHaveBeenCalled();
});
