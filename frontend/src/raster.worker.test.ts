import { beforeEach, expect, it, vi } from "vitest";
import type { TileMessage } from "./tileProtocol";
import { constructedWorld } from "./constructedWorldFixture";
import type { LoadedRaster } from "./types";

const fixture = vi.hoisted(() => ({ load: vi.fn(), process: vi.fn() }));
vi.mock("./spatialRuntime", () => ({ openSpatialRuntime: async () => {} }));
vi.mock("./renderResources", () => ({ openRenderResources: async () => ({ load: fixture.load }) }));
vi.mock("./tileProcessor", () => ({ tileProcessor: () => fixture.process }));
beforeEach(() => {
  vi.resetModules();
  fixture.load.mockReset();
  fixture.process.mockReset();
});

it("keeps a tile pending until its replacement geography registration has loaded", async () => {
  const { tileProcessor } =
    await vi.importActual<typeof import("./tileProcessor")>("./tileProcessor");
  const { openSpatialRuntime } =
    await vi.importActual<typeof import("./spatialRuntime")>("./spatialRuntime");
  const closeSpatial = await openSpatialRuntime();
  fixture.process.mockImplementation(tileProcessor());
  let receive!: (event: { data: TileMessage }) => void,
    finishFirst!: () => void,
    finishLatest!: () => void;
  const postMessage = vi.fn(),
    raster = (height: number): LoadedRaster => {
      const g = constructedWorld().result.state.surface;
      g.channels.elevation.fill(height);
      return {
        id: "supplied",
        areaId: g.scope.areaId,
        field: g,
        channel: "elevation",
        bounds: g.bounds,
        footprint: g.scope.footprint,
      };
    };
  fixture.load
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = () => resolve({ raster: raster(10), close() {} });
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLatest = () => resolve({ raster: raster(20), close() {} });
        })
    );
  vi.stubGlobal("self", {
    postMessage,
    addEventListener: (_: string, listener: typeof receive) => {
      receive = listener;
    },
  });
  try {
    await import("./raster.worker");
    const reference = {} as Extract<TileMessage, { kind: "resourceRaster" }>["raster"];
    receive({ data: { kind: "resourceRaster", id: 1, raster: reference } });
    await vi.waitFor(() => expect(fixture.load).toHaveBeenCalledTimes(1));
    receive({
      data: { kind: "tile", id: 1, request: 10, extent: [1000, 100, 2000, 900], size: 2 },
    });
    receive({ data: { kind: "resourceRaster", id: 1, raster: reference } });
    finishFirst();
    await vi.waitFor(() => expect(fixture.load).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(postMessage).not.toHaveBeenCalled();
    finishLatest();
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
    expect(postMessage.mock.calls[0][0]).not.toHaveProperty("error");
    expect(postMessage.mock.calls[0][0].values[0]).toBe(20);
  } finally {
    closeSpatial();
    vi.unstubAllGlobals();
  }
});

it("skips released registrations waiting behind a load and closes an obsolete in-flight load", async () => {
  let receive!: (event: { data: TileMessage }) => void, finish!: () => void;
  const firstClose = vi.fn(),
    lastClose = vi.fn();
  fixture.load
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ raster: {}, close: firstClose });
        })
    )
    .mockResolvedValue({ raster: {}, close: lastClose });
  vi.stubGlobal("self", {
    addEventListener: (_: string, listener: typeof receive) => {
      receive = listener;
    },
  });
  try {
    await import("./raster.worker");
    const send = (data: TileMessage) => receive({ data });
    const raster = {} as Extract<TileMessage, { kind: "resourceRaster" }>["raster"];
    send({ kind: "resourceRaster", id: 1, raster });
    await vi.waitFor(() => expect(fixture.load).toHaveBeenCalledTimes(1));
    send({ kind: "resourceRaster", id: 2, raster });
    send({ kind: "release", id: 1, grids: [] });
    send({ kind: "release", id: 2, grids: [] });
    send({ kind: "resourceRaster", id: 3, raster });
    finish();
    await vi.waitFor(() =>
      expect(fixture.process).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "loadedRaster", id: 3 })
      )
    );
    expect(fixture.load).toHaveBeenCalledTimes(2);
    expect(firstClose).toHaveBeenCalledOnce();
    expect(fixture.process).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "loadedRaster", id: 1 })
    );
    send({ kind: "release", id: 3, grids: [] });
    await vi.waitFor(() => expect(lastClose).toHaveBeenCalledOnce());
  } finally {
    vi.unstubAllGlobals();
  }
});
