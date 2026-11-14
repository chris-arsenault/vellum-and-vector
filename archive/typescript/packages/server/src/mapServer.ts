import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Decoder, Encoder } from "cbor-x";
import type { MapReader, MapNavigation, MapLibrary, ReadOptions } from "@atlas/map";
import { dispatchMapRead, dispatchMapNavigation, dispatchMapLibrary } from "@atlas/transport";
import { serveMapAsset, type MapAssetStore } from "./assetRange";
import type { MapFiles } from "./mapFiles";

interface MapHttpServices {
  maps: MapReader;
  navigation: MapNavigation;
  library: MapLibrary;
  assets: MapAssetStore;
  files: MapFiles;
}
const encoder = new Encoder({ useRecords: false }),
  decoder = new Decoder({ useRecords: false });

/** The LAN service receives only map capabilities for these endpoints. */
export function createMapServer(services: MapHttpServices) {
  return createServer((request, response) => {
    handle(request, response, services).catch((error: unknown) => {
      if (response.destroyed) return;
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ message: error instanceof Error ? error.message : "Map request failed." })
      );
    });
  });
}
async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  services: MapHttpServices
) {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "POST") {
    switch (url.pathname) {
      case "/api/maps/read":
        return read(request, response, (call, options) =>
          dispatchMapRead(services.maps, call, options)
        );
      case "/api/maps/navigation":
        return read(request, response, (call, options) =>
          dispatchMapNavigation(services.navigation, call, options)
        );
      case "/api/maps/library":
        return read(request, response, (call, options) =>
          dispatchMapLibrary(services.library, call, options)
        );
    }
  }
  const match = /^\/api\/maps\/([^/]+)\/([^/]+)\/assets\/([^/]+)$/.exec(url.pathname);
  if (match && (request.method === "GET" || request.method === "HEAD")) {
    const [, mapId, revision, assetId] = match.map(decodeURIComponent);
    return serveMapAsset(
      request,
      response,
      services.assets,
      services.files,
      { mapId, revision },
      assetId
    );
  }
  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ message: "Map endpoint was not found." }));
}
async function read(
  request: IncomingMessage,
  response: ServerResponse,
  dispatch: (call: unknown, options: ReadOptions) => Promise<unknown>
) {
  if (request.headers["content-type"] !== "application/cbor") {
    response.writeHead(415);
    response.end();
    return;
  }
  const abort = new AbortController();
  response.once("close", () => abort.abort());
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const call: unknown = decoder.decode(Buffer.concat(chunks));
  const result = await dispatch(call, { signal: abort.signal });
  abort.signal.throwIfAborted();
  response.writeHead(200, { "Content-Type": "application/cbor", "Cache-Control": "no-store" });
  response.end(encoder.encode(result));
}
