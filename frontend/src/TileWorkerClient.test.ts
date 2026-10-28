import { fixtureWorld, fixtureState } from "./testSupport/workspaceFixture";
import { expect, it } from "vitest";
import { createGrid, putChannel, rectangle, cloneSnapshot } from "@atlas/domain";
import { TileWorkerClient } from "./TileWorkerClient";
import { tileProcessor } from "./tileProcessor";
import { numericTileSampler, terrainSampleBands } from "./numericTiles";
import type { TileMessage, TileReply } from "./tileProtocol";
import type { LoadedRaster as Raster, ResourceRaster } from "./types";
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
      if (message.kind === "close") {
        this.onmessage?.(new MessageEvent("message", { data: { kind: "closed" } }));
        continue;
      }
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
  const input = terrainSampleBands,
    output = input + 2;
  for (let pixel = 0; pixel < 36; pixel++)
    expect(tile.slice(pixel * output, pixel * output + input)).toEqual(
      expected.slice(pixel * input, pixel * input + input)
    );
  expect(tile[(2 * 6 + 2) * output + input]).toBeCloseTo(0.04);
  expect(tile[(2 * 6 + 2) * output + input + 1]).toBeCloseTo(0.2);
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
  worker.flush();
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
it("reuses sources for presentation changes and replaces them when numerical data change", async () => {
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
  const world = fixtureWorld({ name: "Source cache", seed: 1, width: 100, height: 100 });
  const snapshot = fixtureState(world.id).snapshot;
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
  worker.flush();
  expect(worker.terminated).toBe(true);
});
function referencedRaster(): ResourceRaster {
  const raster = fixture(),
    field = raster.field;
  return {
    ...raster,
    field: {
      resourceId: "field:1",
      scope: field.scope,
      bounds: field.bounds,
      units: field.units,
      quantities: { elevation: "intensive" },
      channels: { elevation: { range: [-10, 14], categories: [] } },
      patches: [],
    },
    water: undefined,
    ice: undefined,
    surface: undefined,
    geography: {
      scope: field.scope,
      areaId: raster.areaId,
      geographyId: "layout:1",
      windows: [field.bounds],
      tolerance: 1,
      revision: 1,
    },
  };
}
it("orders resource registration, cancellation and release after the peer connection", async () => {
  const worker = new WorkerFixture();
  let connected!: () => void;
  const ready = new Promise<void>((resolve) => {
    connected = resolve;
  });
  const client = new TileWorkerClient(
    () => worker as unknown as Worker,
    () => ready
  );
  const id = client.register(referencedRaster()),
    abort = new AbortController();
  const pending = client.load(id, [0, 0, 100, 100], 4, abort.signal);
  const cancelled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  abort.abort();
  client.release(id);
  client.dispose();
  expect(worker.messages).toHaveLength(0);
  connected();
  await ready;
  await cancelled;
  expect(worker.messages.map((message) => message.kind)).toEqual([
    "resourceRaster",
    "tile",
    "cancel",
    "release",
    "close",
  ]);
  worker.flush();
  expect(worker.terminated).toBe(true);
});
it("surfaces peer connection failure to waiting tiles and closes the renderer", async () => {
  const worker = new WorkerFixture();
  const error = new Error("Geographic workspace unavailable");
  const client = new TileWorkerClient(
    () => worker as unknown as Worker,
    () => Promise.reject(error)
  );
  const id = client.register(referencedRaster());
  await expect(client.load(id, [0, 0, 100, 100], 4, new AbortController().signal)).rejects.toThrow(
    error
  );
  client.dispose();
  await Promise.resolve();
  expect(worker.terminated).toBe(true);
});
it("retains a raster source across equivalent references and viewport geography changes", async () => {
  const worker = new WorkerFixture();
  const client = new TileWorkerClient(
    () => worker as unknown as Worker,
    async () => {}
  );
  const sources = new RasterSources(new Projection({ code: "world", units: "m" }), client);
  const raster = referencedRaster();
  sources.begin();
  const first = sources.source(raster);
  sources.end();
  sources.begin();
  expect(sources.source(structuredClone(raster))).toBe(first);
  sources.end();
  // Resource messages wait for the workspace connection, so settle the microtask queue.
  const settle = async () => {
    for (let i = 0; i < 3; i++) await Promise.resolve();
  };
  const registrations = () => worker.messages.filter((m) => m.kind === "resourceRaster");
  await settle();
  expect(registrations()).toHaveLength(1);
  // A new geographic window updates the same registration in place: no release, no reopen.
  const changed = structuredClone(raster);
  changed.geography.windows = [[20, 20, 80, 80]];
  sources.begin();
  expect(sources.source(changed)).toBe(first);
  sources.end();
  await settle();
  expect(registrations().map((m) => m.id)).toEqual([registrations()[0].id, registrations()[0].id]);
  expect(worker.messages.some((m) => m.kind === "release")).toBe(false);
  // Different immutable inputs still replace the source.
  const replaced = structuredClone(raster);
  replaced.field.resourceId = "field:2";
  sources.begin();
  expect(sources.source(replaced)).not.toBe(first);
  sources.end();
  await settle();
  expect(worker.messages.some((m) => m.kind === "release")).toBe(true);
  sources.dispose();
  await Promise.resolve();
  worker.flush();
});
