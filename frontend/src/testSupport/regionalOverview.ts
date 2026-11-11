import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import {
  chartCopies,
  rectangle,
  spatial,
  type AtlasFeature,
  type Bounds,
  type World,
} from "@atlas/domain";
import type { CompletedBoundary } from "@atlas/generation";
import type { Geometry, Position } from "geojson";
import { rasterLimits, tilePainter } from "../rasterTiles";
import type { LoadedRaster } from "../types";

const imageSize = 1400;
/** What a drawing reads of a feature. */
type Drawn = Pick<AtlasFeature, "kind" | "layerId" | "geometry" | "attributes">;
interface View {
  extent: Bounds;
  reference: World["reference"];
}

/**
 * Local generated artifact: the production terrain painter (cover, relief shading and
 * lakes) with the published rivers, lake shores, roads, summits, cols, magic sites and
 * settlements drawn over it. One fixed symbol set serves every comparison render.
 */
export async function regionalOverview(
  result: CompletedBoundary,
  features: AtlasFeature[],
  name = "standard-overview",
  directory = ".artifacts/regional"
) {
  await rasterOverview(surfaceRaster(result), features, name, directory);
}
/** The same overview from any loaded terrain raster, such as a published map's. */
export async function rasterOverview(
  raster: LoadedRaster,
  features: Drawn[],
  name: string,
  directory: string,
  view?: View
) {
  const image = paintedRaster(raster, view);
  for (const bounds of image.frames) {
    const frame = { ...image, bounds };
    for (const f of features) drawLine(frame, f);
    for (const f of features) drawSymbol(frame, f);
  }
  await savePng(image, name, directory);
}
/** The painted terrain alone, from any loaded terrain raster. */
export async function rasterRelief(
  raster: LoadedRaster,
  name: string,
  directory: string,
  view?: View
) {
  await savePng(paintedRaster(raster, view), name, directory);
}

/** Rivers by order, lake shores and roads, in that order. */
function drawLine(image: Image, f: Drawn) {
  if (f.kind === "river")
    strokeGeometry(image, f.geometry, [34, 98, 143], Number(f.attributes.order ?? 1) > 2 ? 2 : 1);
  if (f.kind === "lake") strokeGeometry(image, f.geometry, [20, 70, 110], 1);
  if (f.kind === "road") strokeGeometry(image, f.geometry, [122, 84, 40], 1);
}

/** Settlement dots, summit triangles, col crosses, waterfall and magic-site dots. */
function drawSymbol(image: Image, f: Drawn) {
  if (f.geometry.type !== "Point") return;
  const p = f.geometry.coordinates;
  if (f.kind === "settlement") dot(image, p, [39, 37, 29]);
  else if (f.kind === "peak") triangle(image, p, [60, 30, 20]);
  else if (f.kind === "pass") cross(image, p, [60, 30, 20]);
  else if (f.kind === "waterfall") dot(image, p, [30, 90, 230]);
  else if (f.layerId === "magic") dot(image, p, [170, 40, 160], 1);
}

/** The production painter alone, for inspecting developed relief and cover. */
export async function regionalReliefOverview(
  result: CompletedBoundary,
  name = "standard-relief",
  directory = ".artifacts/regional"
) {
  await savePng(paintedRaster(surfaceRaster(result)), name, directory);
}

interface Image {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  bounds: number[];
  span: number;
  frames: Bounds[];
}

function surfaceRaster(result: CompletedBoundary): LoadedRaster {
  const g = result.state.surface;
  return {
    id: g.id,
    areaId: g.scope.areaId,
    field: g,
    water: g,
    ice: g,
    footprint: g.scope.footprint,
    bounds: g.bounds,
    channel: "Elevation",
  };
}
function paintedRaster(raster: LoadedRaster, view?: View): Image {
  const bounds = view?.extent ?? raster.field.bounds,
    [w, s, e, n] = bounds,
    span = Math.max(e - w, n - s),
    squareBounds: Bounds = [w, n - span, w + span, n],
    frames = view
      ? chartCopies(view.reference, rectangle(squareBounds)).map((shape) => spatial.bounds(shape))
      : [squareBounds],
    paint = tilePainter(raster, rasterLimits([raster])),
    width = Math.round((imageSize * (e - w)) / span),
    height = Math.round((imageSize * (n - s)) / span),
    pixels = new Uint8ClampedArray(width * height * 4);
  for (const frame of frames) {
    const square = paint(frame, imageSize);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = (y * imageSize + x) * 4;
        if (square[at + 3]) {
          const target = (y * width + x) * 4;
          pixels[target] = square[at];
          pixels[target + 1] = square[at + 1];
          pixels[target + 2] = square[at + 2];
          pixels[target + 3] = square[at + 3];
        }
      }
  }
  return { pixels, width, height, bounds, span, frames };
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

function dot(image: Image, position: Position, color: number[], radius = 2) {
  const [x, y] = pixel(image, position);
  for (let oy = -radius; oy <= radius; oy++)
    for (let ox = -radius; ox <= radius; ox++)
      if (ox * ox + oy * oy <= radius * radius + 1) plot(image, x + ox, y + oy, color);
}

function triangle(image: Image, position: Position, color: number[]) {
  const [x, y] = pixel(image, position);
  for (let row = 0; row <= 4; row++)
    for (let ox = -row / 2; ox <= row / 2; ox += 0.5) plot(image, x + ox, y - 3 + row, color);
}

function cross(image: Image, position: Position, color: number[]) {
  const [x, y] = pixel(image, position);
  for (let k = -2; k <= 2; k++) {
    plot(image, x + k, y + k, color);
    plot(image, x + k, y - k, color);
  }
}

async function savePng(image: Image, name: string, directory: string) {
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
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/${name}.png`, png);
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
