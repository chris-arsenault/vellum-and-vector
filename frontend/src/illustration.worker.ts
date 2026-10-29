import { spatial } from "@atlas/domain";
import type { Raster, LoadedRaster } from "./types";
import { terrainMarks, terrainSymbolsAcrossSubject } from "./drawnTerrain";
import { fieldMarks } from "./drawnFields";
import type { LoadedDrawnMapInput } from "./drawnMap";
import { drawingGeography, drawingOceans } from "./drawnGeography";
import { bounds } from "./presentation";
import { openRenderResources } from "./renderResources";
import type { IllustrationRequest, IllustrationReply } from "./illustrationProtocol";
import { WorkspaceClient } from "./WorkspaceClient";
import { drawingIdentity, type StoredDrawing } from "./drawnIdentity";

let latest: IllustrationRequest | undefined;
let running = false,
  closing = false;
let resources: ReturnType<typeof openRenderResources> | undefined;
let workspace: WorkspaceClient | undefined;
let port: MessagePort | undefined;
/** Products are assembled once per subject, scale and input revision, and stored. */
async function illustrate(request: IllustrationRequest) {
  const { family, stamp } = drawingIdentity(request.input, request.footprint),
    worldId = request.input.world.id;
  const stored = await workspace?.readProduct<StoredDrawing>(worldId, family, stamp);
  if (closing || latest) return;
  if (stored) {
    const reply: IllustrationReply = {
      ...stored,
      id: request.id,
      geography: new Map(stored.geography),
    };
    self.postMessage(reply);
    return;
  }
  const reply = await assemble(request);
  if (!reply) return;
  self.postMessage(reply);
  const products: StoredDrawing = {
    oceans: reply.oceans,
    coasts: reply.coasts,
    outside: reply.outside,
    terrain: reply.terrain,
    fields: reply.fields,
    geography: [...reply.geography],
  };
  await workspace?.writeProduct(worldId, family, stamp, products);
}
async function assemble({ id, input, footprint }: IllustrationRequest) {
  const reader = await (resources ??= openRenderResources(workspace));
  const close: (() => void)[] = [];
  async function load(rasters: Raster[]): Promise<LoadedRaster[]> {
    const result: LoadedRaster[] = [];
    for (const raster of rasters) {
      if (closing || latest) break;
      const loaded = await reader.load(raster);
      close.push(loaded.close);
      result.push(loaded.raster);
    }
    return result;
  }
  try {
    const selected = new Set(input.view.fields);
    if (input.view.terrain) selected.add("treeCover");
    const loaded: LoadedDrawnMapInput = {
      ...input,
      base: await load(input.base),
      rasters: await load(input.rasters.filter((raster) => selected.has(raster.channel))),
    };
    if (closing || latest) return null;
    const oceans = drawingOceans(input.features, loaded.base),
      box = bounds(footprint);
    const step = (box[2] - box[0]) / terrainSymbolsAcrossSubject;
    const coasts = oceans.flatMap((ocean) =>
      [0.1, 0.23].flatMap((fraction) => {
        const shape = spatial.buffer(ocean, -step * fraction);
        return shape ? [shape] : [];
      })
    );
    const reply: IllustrationReply = {
      id,
      geography: drawingGeography(input.features, loaded.base),
      oceans,
      coasts,
      outside: input.view.clip ? spatial.difference(input.world.reference.domain, footprint) : null,
      terrain: terrainMarks(loaded, footprint),
      fields: fieldMarks(loaded, footprint),
    };
    return reply;
  } finally {
    for (const release of close) release();
  }
}
async function drain() {
  running = true;
  while (latest && !closing) {
    const request = latest;
    latest = undefined;
    try {
      await illustrate(request);
    } catch (error) {
      self.postMessage({
        id: request.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  running = false;
  if (closing) {
    try {
      if (resources) await (await resources).close();
    } finally {
      port?.close();
      self.postMessage({ kind: "closed" });
      self.close();
    }
  }
}
self.onmessage = (
  event: MessageEvent<
    IllustrationRequest | { kind: "close" } | { kind: "connect"; port: MessagePort }
  >
) => {
  if ("kind" in event.data && event.data.kind === "connect") {
    port = event.data.port;
    workspace = new WorkspaceClient(port);
    return;
  }
  if ("kind" in event.data) {
    closing = true;
    latest = undefined;
  } else latest = event.data;
  if (!running) void drain();
};
