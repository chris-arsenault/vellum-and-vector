import { requireChannel, MapScale, type FieldChannelName } from "@atlas/domain";
import { expect, it } from "vitest";
import {
  adaptiveGeometry,
  createAdaptiveField,
  createAdaptiveTopology,
  fillBand,
  generateBand,
  rectangle,
  putChannel,
  canonryMagicPresets,
  magicSurfaceCode,
  surfaceCategories,
  surfaceCode,
} from "@atlas/domain";
import { categorical, tilePainter, rasterTileSource } from "./rasterTiles";
import Projection from "ol/proj/Projection.js";
import type { LoadedRaster as Raster } from "./types";

function fixture(channel: FieldChannelName = "Elevation"): Raster {
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
    channel === "PhysicalMaterial" ? "category" : "native-length",
    generateBand(field.coverage, "float64", channel, (i) => {
      const x = geometry.x.get(i);
      return channel === "PhysicalMaterial"
        ? x < 500
          ? 0
          : 1
        : MapScale.native(400 + x * 0.2 + geometry.y.get(i) * 0.1);
    })
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
  const raster = fixture("PhysicalMaterial"),
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
  requireChannel(patch, "Elevation").fill(MapScale.native(900));
  raster.field.overlays = [{ grid: patch, channels: ["Elevation"] }];
  const edited = tilePainter(raster, [0, 1000]);
  expect(edited([490, 490, 510, 510], 16)).not.toEqual(original([490, 490, 510, 510], 16));
  expect(edited([100, 100, 120, 120], 16)).toEqual(original([100, 100, 120, 120], 16));
});

it("shades dry coastal terrain from its height rather than a nearest-cell water mask", () => {
  const raster = fixture(),
    dry = tilePainter(raster, [0, 1000]);
  raster.water = {
    ...raster.field,
    channels: { WaterKindCodes: generateBand(raster.field.coverage, "float64", "water", () => 1) },
    units: { WaterKindCodes: "category" },
  };
  expect(tilePainter(raster, [0, 1000])([400, 400, 600, 600], 32)).toEqual(
    dry([400, 400, 600, 600], 32)
  );
});

it("fills only the lake polygon below its physical stage and leaves an emergent island dry", () => {
  const raster = fixture();
  requireChannel(raster.field, "Elevation").fill(MapScale.native(400));
  raster.lakes = [{ geometry: rectangle([200, 200, 800, 800]), level: 500 }];
  const island = fixture().field;
  island.scope = { ...island.scope, footprint: rectangle([450, 450, 550, 550]) };
  requireChannel(island, "Elevation").fill(MapScale.native(600));
  raster.field.overlays = [{ grid: island, channels: ["Elevation"] }];
  const paint = tilePainter(raster, [0, 1000]);
  const wet = [73, 139, 153, 255];
  expect([...paint([290, 290, 310, 310], 1)]).toEqual(wet);
  expect([...paint([490, 490, 510, 510], 1)]).not.toEqual(wet);
  expect([...paint([90, 290, 110, 310], 1)]).not.toEqual(wet);
});

it("colors sea and exposed coast relative to the current sea level rather than zero datum", () => {
  const raster = fixture();
  requireChannel(raster.field, "Elevation").fill(MapScale.native(100));
  raster.water = {
    ...raster.field,
    channels: {
      EffectiveSeaLevel: generateBand(raster.field.coverage, "float64", "EffectiveSeaLevel", () =>
        MapScale.native(200)
      ),
    },
    units: { EffectiveSeaLevel: "native-length" },
  };
  const submerged = tilePainter(raster, [-1000, 1000])([400, 400, 600, 600], 1);
  expect(submerged[2]).toBeGreaterThan(submerged[0]);
  requireChannel(raster.field, "Elevation").fill(MapScale.native(-50));
  requireChannel(raster.water!, "EffectiveSeaLevel").fill(MapScale.native(-100));
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

it("preserves natural cover contrast beneath Aurora in exported terrain", () => {
  const raster = fixture(),
    classes = surfaceCategories(canonryMagicPresets());
  requireChannel(raster.field, "Elevation").fill(MapScale.native(400));
  raster.surface = raster.field;
  const zeros = (name: string) => generateBand(raster.field.coverage, "float64", name, () => 0);
  putChannel(raster.surface, "naturalSurface", "category", zeros("naturalSurface"), "category");
  putChannel(raster.surface, "finalSurface", "category", zeros("finalSurface"), "category");
  const color = (natural: "Boreal forest" | "Scree field", magic: boolean) => {
    requireChannel(raster.surface!, "naturalSurface").fill(surfaceCode(natural));
    requireChannel(raster.surface!, "finalSurface").fill(
      magic ? magicSurfaceCode(canonryMagicPresets(), "aurora", "field")! : surfaceCode(natural)
    );
    return tilePainter(raster, [0, 1000], classes)([490, 490, 510, 510], 1);
  };
  const contrast = (a: Uint8ClampedArray, b: Uint8ClampedArray) =>
    a.slice(0, 3).reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0);
  const natural = contrast(color("Boreal forest", false), color("Scree field", false));
  const magical = contrast(color("Boreal forest", true), color("Scree field", true));
  expect(magical).toBeGreaterThan(natural / 2);
});

it("retains opposite-facing relief under completely opaque ice in exported terrain", () => {
  const raster = fixture(),
    geometry = adaptiveGeometry(raster.field.topology!);
  fillBand(requireChannel(raster.field, "Elevation"), (i) =>
    MapScale.native(400 + Math.abs(geometry.x.get(i) - 500) * 0.2)
  );
  raster.ice = {
    ...raster.field,
    channels: {
      IceThickness: generateBand(raster.field.coverage, "float64", "IceThickness", () => 1000),
    },
    units: { IceThickness: "metre" },
  };
  const paint = tilePainter(raster, [0, 1000]);
  const west = paint([240, 490, 260, 510], 1),
    east = paint([740, 490, 760, 510], 1);
  expect(Math.abs(west[0] - east[0])).toBeGreaterThan(20);
});

it("shows submerged relief instead of flattening every ocean feature to a depth color", () => {
  const sloped = fixture(),
    flat = fixture();
  const geometry = adaptiveGeometry(sloped.field.topology!);
  fillBand(requireChannel(sloped.field, "Elevation"), (i) =>
    MapScale.native(-600 + geometry.x.get(i) * 0.2)
  );
  requireChannel(flat.field, "Elevation").fill(MapScale.native(-500));
  expect(tilePainter(sloped, [-1000, 0])([490, 490, 510, 510], 1)).not.toEqual(
    tilePainter(flat, [-1000, 0])([490, 490, 510, 510], 1)
  );
});
