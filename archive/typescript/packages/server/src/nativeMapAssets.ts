import { spawn } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { openAsBlob, openSync, closeSync, readSync, writeSync, fsyncSync } from "node:fs";
import { join } from "node:path";
import { MapAssets, type MapAssetFiles } from "@atlas/storage-browser/maps";
import type { RasterPublicationInput } from "@atlas/engine";
import type { RasterSource } from "@atlas/map";

/** Vector streaming is shared; the native Rust target owns raster encoding and overviews. */
export class NativeMapAssets extends MapAssets {
  constructor(
    private directory: string,
    private executable: string,
    private cacheBytes: number
  ) {
    super(nativeFiles(directory));
  }
  override async raster(
    input: RasterPublicationInput,
    rows: AsyncIterable<Float32Array>,
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted();
    await mkdir(this.directory, { recursive: true });
    const location = `${crypto.randomUUID()}.tif`,
      output = assetPath(this.directory, location);
    const scratch = assetPath(this.directory, `${crypto.randomUUID()}.scratch`);
    let complete = false;
    try {
      const source = await publishRaster(
        this.executable,
        output,
        scratch,
        this.cacheBytes,
        input,
        rows,
        signal
      );
      const asset = {
        id: input.assetId,
        location,
        mediaType: source.mediaType,
        byteLength: (await stat(output)).size,
        illustration: false,
      };
      complete = true;
      return { source, asset };
    } finally {
      await rm(scratch, { force: true });
      if (!complete) await rm(output, { force: true });
    }
  }
}
async function publishRaster(
  executable: string,
  output: string,
  scratch: string,
  cacheBytes: number,
  input: RasterPublicationInput,
  rows: AsyncIterable<Float32Array>,
  signal?: AbortSignal
): Promise<RasterSource> {
  const child = spawn(executable, [output, scratch, String(cacheBytes)], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let reply = "",
    errorText = "",
    failure: Error | undefined;
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    reply += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    errorText += chunk;
  });
  child.on("error", (error) => {
    failure = error;
  });
  child.stdin.on("error", (error) => {
    failure = error;
  });
  const closed = new Promise<number | null>((resolve) => child.once("close", resolve));
  const cancel = () => {
    child.kill();
  };
  signal?.addEventListener("abort", cancel, { once: true });
  const write = (value: string | Uint8Array) =>
    new Promise<void>((resolve, reject) =>
      child.stdin.write(value, (error) => (error ? reject(error) : resolve()))
    );
  try {
    signal?.throwIfAborted();
    await write(`${JSON.stringify(input)}\n`);
    for await (const row of rows) {
      signal?.throwIfAborted();
      await write(new Uint8Array(row.buffer, row.byteOffset, row.byteLength));
    }
    child.stdin.end();
    const code = await closed;
    signal?.throwIfAborted();
    if (failure) throw failure;
    if (code !== 0) throw new Error(errorText || `Raster publisher closed (${code}).`);
    return JSON.parse(reply) as RasterSource;
  } finally {
    signal?.removeEventListener("abort", cancel);
    child.kill();
    await closed;
  }
}
function nativeFiles(directory: string): MapAssetFiles {
  return {
    async file(location) {
      return new File([await openAsBlob(assetPath(directory, location))], location);
    },
    async remove(location) {
      await rm(assetPath(directory, location), { force: true });
    },
    async create(location) {
      await mkdir(directory, { recursive: true });
      const fd = openSync(assetPath(directory, location), "wx+");
      let closed = false;
      return {
        read: (bytes, offset) => readSync(fd, bytes, 0, bytes.length, offset),
        write: (bytes, offset) => writeSync(fd, bytes, 0, bytes.length, offset),
        flush: () => fsyncSync(fd),
        close() {
          if (!closed) {
            closed = true;
            closeSync(fd);
          }
        },
      };
    },
  };
}
function assetPath(directory: string, location: string) {
  if (!/^[a-zA-Z0-9_-]+\.[a-z]+$/.test(location)) throw new Error("Invalid map asset location.");
  return join(directory, location);
}
