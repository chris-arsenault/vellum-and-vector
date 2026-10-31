import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import type { AtlasFeature } from "@atlas/domain";
import type { CompletedBoundary } from "@atlas/generation";
import type { Geometry, Position } from "geojson";
import { rasterLimits, tilePainter } from "../rasterTiles";

const imageSize = 1400;

/**
 * Local generated artifact: the production terrain painter (cover, relief shading and
 * lakes) with the published rivers, lake shores and settlements drawn over it.
 */
export async function regionalOverview(
  result: CompletedBoundary,
  features: AtlasFeature[],
  name = "standard-overview"
) {
  const image = paintedSurface(result);
  for (const f of features) {
    if (f.kind === "river")
      strokeGeometry(image, f.geometry, [34, 98, 143], Number(f.attributes.order ?? 1) > 2 ? 2 : 1);
    if (f.kind === "lake") strokeGeometry(image, f.geometry, [20, 70, 110], 1);
    if (f.kind === "settlement" && f.geometry.type === "Point")
      dot(image, f.geometry.coordinates, [39, 37, 29]);
  }
  await savePng(image, name);
}

/** The production painter alone, for inspecting developed relief and cover. */
export async function regionalReliefOverview(result: CompletedBoundary, name = "standard-relief") {
  await savePng(paintedSurface(result), name);
}

interface Image {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  bounds: number[];
  span: number;
}

function paintedSurface(result: CompletedBoundary): Image {
  const g = result.state.surface,
    [w, s, e, n] = g.bounds,
    span = Math.max(e - w, n - s),
    raster = {
      id: g.id,
      areaId: g.scope.areaId,
      field: g,
      water: g,
      ice: g,
      footprint: g.scope.footprint,
      bounds: g.bounds,
      channel: "elevation",
    },
    square = tilePainter(raster, rasterLimits([raster]))([w, n - span, w + span, n], imageSize),
    width = Math.round((imageSize * (e - w)) / span),
    height = Math.round((imageSize * (n - s)) / span),
    pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    pixels.set(square.subarray(y * imageSize * 4, (y * imageSize + width) * 4), y * width * 4);
  return { pixels, width, height, bounds: g.bounds, span };
}

function pixel(image: Image, [x, y]: Position) {
  return [
    ((x - image.bounds[0]) / image.span) * imageSize,
    ((image.bounds[3] - y) / image.span) * imageSize,
  ];
}

function plot(image: Image, x: number, y: number, color: number[]) {
  const col = Math.round(x),
    row = Math.round(y);
  if (col < 0 || row < 0 || col >= image.width || row >= image.height) return;
  image.pixels.set([...color, 255], (row * image.width + col) * 4);
}

function strokeGeometry(image: Image, geometry: Geometry, color: number[], width: number) {
  const lines =
    geometry.type === "LineString"
      ? [geometry.coordinates]
      : geometry.type === "MultiLineString" || geometry.type === "Polygon"
        ? geometry.coordinates
        : geometry.type === "MultiPolygon"
          ? geometry.coordinates.flat()
          : [];
  for (const line of lines)
    for (let k = 1; k < line.length; k++) {
      const [x0, y0] = pixel(image, line[k - 1]),
        [x1, y1] = pixel(image, line[k]),
        steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
      for (let t = 0; t <= steps; t++) {
        const x = x0 + ((x1 - x0) * t) / steps,
          y = y0 + ((y1 - y0) * t) / steps;
        plot(image, x, y, color);
        if (width > 1) plot(image, x + 1, y, color);
      }
    }
}

function dot(image: Image, position: Position, color: number[]) {
  const [x, y] = pixel(image, position);
  for (let oy = -2; oy <= 2; oy++)
    for (let ox = -2; ox <= 2; ox++) if (ox * ox + oy * oy <= 5) plot(image, x + ox, y + oy, color);
}

async function savePng(image: Image, name: string) {
  const raw = Buffer.alloc((image.width * 4 + 1) * image.height);
  for (let y = 0; y < image.height; y++)
    Buffer.from(
      image.pixels.buffer,
      image.pixels.byteOffset + y * image.width * 4,
      image.width * 4
    ).copy(raw, y * (image.width * 4 + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  await mkdir(".artifacts/regional", { recursive: true });
  await writeFile(`.artifacts/regional/${name}.png`, png);
}

function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4),
    body = Buffer.concat([Buffer.from(type, "ascii"), data]),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function crc32(data: Buffer) {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
