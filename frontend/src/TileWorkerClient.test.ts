import { expect, it } from "vitest";
import { createGrid, putChannel, rectangle, cloneSnapshot } from "@atlas/domain";
import { createWorld, session } from "./atlasState";
import { TileWorkerClient } from "./TileWorkerClient";
import { tileProcessor } from "./tileProcessor";
import { numericTileSampler } from "./numericTiles";
import type { TileMessage, TileReply } from "./tileProtocol";
import type { Raster } from "./types";
import { RasterSources } from "./RasterSources";
import Projection from "ol/proj/Projection.js";

function fixture(): Raster {
  const field = createGrid(
    "terrain",
    {
      worldId: "w",
      areaId: "a",
      spaceId: "s",
      crsId: "m",
      footprint: rectangle([0, 0, 100, 100]),
      time: "present",
      resolution: 25,
      revision: 1,
    },
    5,
    5
  );
  putChannel(
    field,
    "elevation",
    "metre",
    Float64Array.from({ length: 25 }, (_, i) => i - 10)
  );
  putChannel(
    field,
    "temperature",
    "celsius",
    Float64Array.from({ length: 25 }, (_, i) => i)
  );
  return {
    id: "terrain",
    areaId: "a",
    footprint: field.scope.footprint,
    bounds: field.bounds,
    field,
    channel: "elevation",
  };
}
class WorkerFixture {
  messages: TileMessage[] = [];
  onmessage: ((event: MessageEvent<TileReply>) => void) | null = null;
  onerror = null;
  terminated = false;
  private process = tileProcessor();
  postMessage(message: TileMessage) {
    this.messages.push(structuredClone(message));
  }
  flush() {
    for (const message of this.messages.splice(0)) {
      const reply = this.process(message);
      if (reply) this.onmessage?.(new MessageEvent("message", { data: reply }));
    }
  }
  terminate() {
    this.terminated = true;
  }
}
it("shares immutable grid registration across channels and preserves actual sampler values", async () => {
  const worker = new WorkerFixture(),
    client = new TileWorkerClient(() => worker as unknown as Worker);
  const raster = fixture();
  const elevation = client.register(raster),
    temperature = client.register({ ...raster, channel: "temperature" });
  expect(worker.messages.filter((m) => m.kind === "grid")).toHaveLength(1);
  const result = client.load(elevation, [20, 20, 80, 80], 6, new AbortController().signal);
  worker.flush();
  const tile = await result,
    expected = numericTileSampler(raster)([20, 20, 80, 80], 6);
  for (let pixel = 0; pixel < 36; pixel++)
    expect(tile.slice(pixel * 9, pixel * 9 + 7)).toEqual(expected.slice(pixel * 7, pixel * 7 + 7));
  expect(tile[(2 * 6 + 2) * 9 + 7]).toBeCloseTo(0.04);
  expect(tile[(2 * 6 + 2) * 9 + 8]).toBeCloseTo(0.2);
  client.release(elevation);
  expect(worker.messages).toContainEqual({ kind: "release", id: elevation, grids: [] });
  worker.flush();
  const heat = client.load(temperature, [20, 20, 80, 80], 6, new AbortController().signal);
  worker.flush();
  expect(await heat).toEqual(
    numericTileSampler({ ...raster, channel: "temperature" })([20, 20, 80, 80], 6)
  );
  expect(raster.field.channels.elevation.length).toBe(25);
  client.release(temperature);
  expect(worker.messages.some((m) => m.kind === "release" && m.grids.length === 1)).toBe(true);
  client.dispose();
  expect(worker.terminated).toBe(true);
});
it("rejects aborted and replaced tiles and ignores obsolete replies", async () => {
  const worker = new WorkerFixture(),
    client = new TileWorkerClient(() => worker as unknown as Worker);
  const id = client.register(fixture()),
    abort = new AbortController();
  worker.flush();
  const old = client.load(id, [0, 0, 100, 100], 4, abort.signal);
  const rejected = expect(old).rejects.toMatchObject({ name: "AbortError" });
  abort.abort();
  worker.flush();
  await rejected;
  const pending = client.load(id, [0, 0, 100, 100], 4, new AbortController().signal);
  const replaced = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  client.release(id);
  worker.flush();
  await replaced;
  client.dispose();
});
it("reuses sources for presentation changes and replaces them when numerical data change", () => {
  const worker = new WorkerFixture(),
    client = new TileWorkerClient(() => worker as unknown as Worker);
  const sources = new RasterSources(
    new Projection({ code: "world", units: "m", extent: [0, 0, 100, 100] }),
    client
  );
  const raster = fixture();
  sources.begin();
  const first = sources.source(raster);
  sources.end();
  sources.begin();
  expect(sources.source({ ...raster })).toBe(first);
  sources.end();
  expect(worker.messages.filter((m) => m.kind === "grid")).toHaveLength(1);
  const world = createWorld({ name: "Source cache", seed: 1, width: 100, height: 100 });
  const snapshot = session(world.id).snapshot;
  snapshot.numerical.terrain = raster.field;
  const cloned = cloneSnapshot(snapshot).numerical.terrain;
  expect(cloned).not.toBe(raster.field);
  sources.begin();
  expect(sources.source({ ...raster, field: cloned })).toBe(first);
  sources.end();
  expect(worker.messages.filter((m) => m.kind === "grid")).toHaveLength(1);
  const next = { ...raster, field: structuredClone(raster.field) };
  next.field.channels.elevation.fill(400);
  sources.begin();
  expect(sources.source(next)).not.toBe(first);
  sources.end();
  expect(worker.messages.filter((m) => m.kind === "release")).toHaveLength(1);
  sources.begin();
  sources.end();
  expect(worker.messages.filter((m) => m.kind === "release")).toHaveLength(2);
  sources.dispose();
  expect(worker.terminated).toBe(true);
});
