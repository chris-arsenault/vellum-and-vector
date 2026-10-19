import { expect, it } from "vitest";
import {
  adaptiveGeometry,
  createAdaptiveField,
  createAdaptiveTopology,
  rectangle,
  putChannel,
} from "@atlas/domain";
import { categorical, tilePainter, rasterTileSource } from "./rasterTiles";
import Projection from "ol/proj/Projection.js";
import type { Raster } from "./types";

function fixture(channel = "elevation"): Raster {
  const topology = createAdaptiveTopology([0, 0, 1000, 1000], {
    maximumSize: 250,
    minimumSize: 31.25,
    refine: ([x, y, right, top]) => x < 550 && right > 450 && y < 700 && top > 300,
  });
  const field = createAdaptiveField(
    "field",
    {
      worldId: "world",
      areaId: "area",
      spaceId: "surface",
      crsId: "metres",
      footprint: rectangle([0, 0, 1000, 1000]),
      time: "present",
      revision: 1,
      resolution: null,
    },
    topology
  );
  const geometry = adaptiveGeometry(topology);
  putChannel(
    field,
    channel,
    channel === "material" ? "category" : "metre",
    Float64Array.from(geometry.x, (x, i) =>
      channel === "material" ? (x < 500 ? 0 : 1) : 400 + x * 0.2 + geometry.y[i] * 0.1
    )
  );
  return {
    id: field.id,
    areaId: "area",
    channel,
    field,
    footprint: field.scope.footprint,
    bounds: field.bounds,
  };
}

it("renders adjacent tiles exactly like the same pixels in one larger view, including hillshade", () => {
  const paint = tilePainter(fixture(), [0, 1000]);
  const whole = paint([0, 0, 1000, 1000], 128);
  for (let ty = 0; ty < 2; ty++)
    for (let tx = 0; tx < 2; tx++) {
      const tile = paint([tx * 500, ty * 500, (tx + 1) * 500, (ty + 1) * 500], 64);
      for (let row = 0; row < 64; row++) {
        const offset = ((1 - ty) * 64 + row) * 128 * 4 + tx * 64 * 4;
        expect(tile.slice(row * 256, (row + 1) * 256)).toEqual(whole.slice(offset, offset + 256));
      }
    }
});

it("keeps material samples discrete and leaves pixels outside coverage transparent", () => {
  const raster = fixture("material"),
    paint = tilePainter(raster, [0, 1]);
  expect(categorical(raster)).toBe(true);
  const pixels = paint([-500, -500, 1500, 1500], 64),
    colors = new Set<string>();
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i + 3]) colors.add([...pixels.slice(i, i + 4)].join(","));
  expect(colors).toEqual(new Set(["80,165,180,165", "230,115,90,165"]));
  expect([...pixels.slice(0, 4)]).toEqual([0, 0, 0, 0]);
});

it("retains an authored patch smaller than a base cell when drawing a close view", () => {
  const raster = fixture(),
    original = tilePainter(raster, [0, 1000]);
  const patch = fixture().field;
  patch.scope = { ...patch.scope, footprint: rectangle([480, 480, 520, 520]) };
  patch.channels.elevation.fill(900);
  raster.field.overlays = [{ grid: patch, channels: ["elevation"] }];
  const edited = tilePainter(raster, [0, 1000]);
  expect(edited([490, 490, 510, 510], 16)).not.toEqual(original([490, 490, 510, 510], 16));
  expect(edited([100, 100, 120, 120], 16)).toEqual(original([100, 100, 120, 120], 16));
});

it("shades dry coastal terrain from its height rather than a nearest-cell water mask", () => {
  const raster = fixture(),
    dry = tilePainter(raster, [0, 1000]);
  raster.water = {
    ...raster.field,
    channels: { water: new Float64Array(raster.field.active.length).fill(1) },
    units: { water: "category" },
  };
  expect(tilePainter(raster, [0, 1000])([400, 400, 600, 600], 32)).toEqual(
    dry([400, 400, 600, 600], 32)
  );
});

it("fills only the lake polygon below its physical stage and leaves an emergent island dry", () => {
  const raster = fixture();
  raster.field.channels.elevation.fill(400);
  raster.lakes = [{ geometry: rectangle([200, 200, 800, 800]), level: 500 }];
  const island = fixture().field;
  island.scope = { ...island.scope, footprint: rectangle([450, 450, 550, 550]) };
  island.channels.elevation.fill(600);
  raster.field.overlays = [{ grid: island, channels: ["elevation"] }];
  const paint = tilePainter(raster, [0, 1000]);
  const wet = [73, 139, 153, 255];
  expect([...paint([290, 290, 310, 310], 1)]).toEqual(wet);
  expect([...paint([490, 490, 510, 510], 1)]).not.toEqual(wet);
  expect([...paint([90, 290, 110, 310], 1)]).not.toEqual(wet);
});

it("colors sea and exposed coast relative to the current sea level rather than zero datum", () => {
  const raster = fixture();
  raster.field.channels.elevation.fill(100);
  raster.water = {
    ...raster.field,
    channels: { seaLevel: new Float64Array(raster.field.active.length).fill(200) },
    units: { seaLevel: "metre" },
  };
  const submerged = tilePainter(raster, [-1000, 1000])([400, 400, 600, 600], 1);
  expect(submerged[2]).toBeGreaterThan(submerged[0]);
  raster.field.channels.elevation.fill(-50);
  raster.water.channels.seaLevel.fill(-100);
  const exposed = tilePainter(raster, [-1000, 1000])([400, 400, 600, 600], 1);
  expect(exposed[0]).toBeGreaterThan(exposed[2]);
});

it("requests finer existing field samples for a higher-density screen", () => {
  const projection = new Projection({
    code: "test-metres",
    units: "m",
    extent: [0, 0, 1000, 1000],
  });
  const standard = rasterTileSource(fixture(), [0, 1000], projection, 1);
  const retina = rasterTileSource(fixture(), [0, 1000], projection, 2);
  expect(standard.getTileGrid()!.getTileSize(0)).toBe(256);
  expect(retina.getTileGrid()!.getTileSize(0)).toBe(128);
  const resolution = 1000 / 1024;
  expect(retina.getTileGrid()!.getZForResolution(resolution)).toBeGreaterThan(
    standard.getTileGrid()!.getZForResolution(resolution)
  );
});

it("shows submerged relief instead of flattening every ocean feature to a depth color", () => {
  const sloped = fixture(),
    flat = fixture();
  const geometry = adaptiveGeometry(sloped.field.topology!);
  sloped.field.channels.elevation.set(Float64Array.from(geometry.x, (x) => -600 + x * 0.2));
  flat.field.channels.elevation.fill(-500);
  expect(tilePainter(sloped, [-1000, 0])([490, 490, 510, 510], 1)).not.toEqual(
    tilePainter(flat, [-1000, 0])([490, 490, 510, 510], 1)
  );
});
