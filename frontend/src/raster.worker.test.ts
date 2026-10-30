import { expect, it, vi } from "vitest";
import type { TileMessage } from "./tileProtocol";

const fixture = vi.hoisted(() => ({ load: vi.fn(), process: vi.fn() }));
vi.mock("./spatialRuntime", () => ({ openSpatialRuntime: async () => {} }));
vi.mock("./renderResources", () => ({ openRenderResources: async () => ({ load: fixture.load }) }));
vi.mock("./tileProcessor", () => ({ tileProcessor: () => fixture.process }));

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
