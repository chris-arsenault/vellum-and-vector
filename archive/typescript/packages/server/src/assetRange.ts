import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import type { MapRef, PublishedAsset } from "@atlas/map";
import type { MapFiles } from "./mapFiles";

export interface MapAssetStore {
  asset(reference: MapRef, id: string): Promise<PublishedAsset>;
}
export function byteRange(header: string | undefined, size: number) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new Error("Unsatisfiable byte range.");
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return validRange(start, end, size);
}
function validRange(start: number, end: number, size: number) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    start >= size
  )
    throw new Error("Unsatisfiable byte range.");
  return { start, end };
}
export async function serveMapAsset(
  request: IncomingMessage,
  response: ServerResponse,
  store: MapAssetStore,
  files: MapFiles,
  reference: MapRef,
  id: string
) {
  const metadata = await store.asset(reference, id),
    file = await files.open(metadata.location);
  try {
    const { size } = await file.stat();
    if (size !== metadata.byteLength)
      throw new Error("Published map asset length differs from its record.");
    response.setHeader("Content-Type", metadata.mediaType);
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    let range;
    try {
      range = byteRange(request.headers.range, size);
    } catch {
      response.writeHead(416, { "Content-Range": `bytes */${size}` });
      response.end();
      return;
    }
    if (range) {
      response.statusCode = 206;
      response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    }
    response.setHeader("Content-Length", range ? range.end - range.start + 1 : size);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    await pipeline(file.createReadStream({ ...range, autoClose: false }), response);
  } finally {
    await file.close();
  }
}
