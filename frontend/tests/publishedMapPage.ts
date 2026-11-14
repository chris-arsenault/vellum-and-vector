import { unByKey } from "ol/Observable.js";
import type { EventsKey } from "ol/events.js";
import type { MapDescriptor } from "@atlas/map";
import {
  RpcMapReader,
  RpcMapNavigation,
  type MapCall,
  type NavigationCall,
} from "@atlas/transport";
import type { RasterPresentation } from "../src/types";
import { createPublishedMap, type PublishedMapEngine } from "../src/publishedMapEngine";
import { publishedStyles, publishedDrawnStyles } from "../src/publishedAppearance";
import { publishedScene } from "../src/publishedScene";
import { defaultCartographicPresentation } from "../src/cartographicPresentation";
import { prepareDrawingGeometry } from "../src/drawingGeometry";
import { PublishedSamples } from "../src/PublishedSamples";
import {
  publishedDrawingContent,
  publishedDrawingMarks,
  type PublishedDrawing,
} from "../src/publishedIllustrationData";
import { updatePublishedDrawing } from "../src/publishedDrawing";
import { PublishedMapUi } from "./publishedMapUi";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const worker = new Worker(new URL("./publishedMap.worker.ts", import.meta.url), { type: "module" });
const output = document.querySelector("output")!;
const host = document.createElement("div");
host.style.cssText = "width:512px;height:512px";
document.body.append(host);
let engine: PublishedMapEngine;
let descriptor: MapDescriptor;
let samples: PublishedSamples;
let closeUi: (() => void) | undefined;
let sequence = 0;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>();
function send(kind: "read" | "navigation", call: MapCall | NavigationCall) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    worker.postMessage({ kind, id, call });
  });
}
const reader = new RpcMapReader((call) => send("read", call));
const navigation = new RpcMapNavigation((call) => send("navigation", call));
const settings: RasterPresentation = {
  base: "surface",
  sunAzimuth: 315,
  sunElevation: 45,
  exaggeration: 1,
  contourInterval: 100,
  fields: [],
};
let observation: EventsKey | undefined;
async function show(base: RasterPresentation["base"] | "temperature" | "biome") {
  if (observation) unByKey(observation);
  const channel =
    base === "temperature" ? "raster:Temperature" : base === "biome" ? "raster:BiomeCodes" : null;
  if (!channel) settings.base = base as RasterPresentation["base"];
  settings.fields = channel
    ? [{ channel, visible: true, opacity: 1, palette: "magma", scale: "linear", range: null }]
    : [];
  await engine.rasters.update(settings);
  const layer = engine.rasters.layers.get(channel ?? "terrain")!;
  observation = layer.on("postrender", (event) => {
    const gl = event.context as WebGLRenderingContext;
    const pixels = new Uint8Array(4);
    gl.readPixels(
      Math.floor(gl.drawingBufferWidth / 2),
      Math.floor(gl.drawingBufferHeight / 2),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels
    );
    if (pixels[3]) output.textContent = JSON.stringify({ base, pixels: [...pixels] });
  });
  engine.map.renderSync();
}
async function vectors() {
  if (observation) unByKey(observation);
  const styles = publishedStyles(descriptor, "physical");
  const layer = styles.find((style) => style.layerId === "vector:geology")!;
  layer.labels = false;
  const records = await publishedScene(
    reader,
    descriptor,
    descriptor.primarySpaceId,
    descriptor.bounds,
    [layer.layerId]
  );
  await engine.vectors.update(records, [], styles);
  observation = engine.vectors.layers.get(layer.layerId)!.on("postrender", (event) => {
    const context = event.context as CanvasRenderingContext2D;
    const pixels = context.getImageData(
      context.canvas.width / 2,
      context.canvas.height / 2,
      1,
      1
    ).data;
    output.textContent = JSON.stringify({ base: "vectors", pixels: [...pixels] });
  });
  engine.map.renderSync();
}
for (const base of [
  "relief",
  "topographic",
  "surface",
  "temperature",
  "biome",
  "vectors",
  "drawing",
  "controls",
] as const) {
  const button = document.createElement("button");
  button.textContent = base;
  button.onclick = () =>
    void (
      base === "controls"
        ? controls()
        : base === "drawing"
          ? drawing()
          : base === "vectors"
            ? vectors()
            : show(base)
    ).catch(failed);
  document.body.append(button);
}
function failed(error: unknown) {
  output.textContent = `Error: ${String(error)}`;
}
async function controls() {
  if (observation) unByKey(observation);
  engine.close();
  await samples?.close();
  host.remove();
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target),
    cache = new QueryClient();
  root.render(
    createElement(
      QueryClientProvider,
      { client: cache },
      createElement(PublishedMapUi, { map: descriptor, reader, navigation })
    )
  );
  closeUi = () => {
    root.unmount();
    cache.clear();
  };
}
async function drawing() {
  if (observation) unByKey(observation);
  samples ??= new PublishedSamples(reader, descriptor);
  const styles = publishedDrawnStyles(descriptor, "physical");
  const features = await publishedScene(
    reader,
    descriptor,
    descriptor.primarySpaceId,
    descriptor.bounds,
    styles.map((style) => style.layerId)
  );
  const input: PublishedDrawing = {
    map: descriptor,
    features,
    entities: [],
    styles,
    view: { ...defaultCartographicPresentation(), mode: "drawn" },
    footprint: descriptor.footprint,
    ancestry: [],
  };
  const geometry = await prepareDrawingGeometry(reader, input);
  const content = publishedDrawingContent(input, geometry);
  const marks = await publishedDrawingMarks(input, content, samples, reader);
  await updatePublishedDrawing(engine, input, { ...geometry, ...marks });
  let canvas: CanvasRenderingContext2D;
  observation = engine.drawing.on("postrender", (event) => {
    canvas = event.context as CanvasRenderingContext2D;
  });
  engine.map.once("rendercomplete", () => {
    const [x, y] = engine.map.getPixelFromCoordinate([60, 60]);
    const patch = canvas.getImageData(Math.floor(x) - 20, Math.floor(y) - 20, 40, 40).data;
    let green = 0;
    for (let i = 0; i < patch.length; i += 4)
      if (patch[i] > 100 && patch[i + 1] > patch[i]) green++;
    output.textContent = JSON.stringify({ base: "drawing", terrain: marks.terrain.length, green });
  });
  engine.map.renderSync();
}
worker.onmessage = ({ data: message }) => {
  if (typeof message.id === "number") {
    const request = pending.get(message.id)!;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.value);
    return;
  }
  if (message.error) {
    failed(message.error);
    return;
  }
  if (message.closed) return;
  descriptor = message.map;
  engine = createPublishedMap(host, descriptor, reader, descriptor.primarySpaceId, 1);
  engine.map.getView().setCenter([50, 50]);
  engine.map.getView().setResolution(100 / 512);
  for (const [label, content] of [
    ["Point inspection", message.inspection],
    ["Region selection", message.selection],
    ["Vector asset", message.geography],
    ["Illustration geography", message.shapes],
  ]) {
    const section = document.createElement("section");
    section.setAttribute("aria-label", label);
    section.textContent = JSON.stringify(content);
    document.body.append(section);
  }
  void show("surface").catch(failed);
};
worker.onerror = (event) => failed(event.message);
worker.postMessage("publish");
window.addEventListener("pagehide", () => {
  closeUi?.();
  engine?.close();
  void samples?.close();
  worker.postMessage("close");
});
