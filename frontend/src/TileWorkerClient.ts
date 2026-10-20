import type { GridSurface } from "@atlas/domain";
import type { Raster } from "./types";
import type { TileMessage, TileReply } from "./tileProtocol";

interface Pending {
  raster: number;
  resolve: (values: Float32Array) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}
export class TileWorkerClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private grids = new Map<GridSurface, { id: number; users: number }>();
  private rasters = new Map<number, GridSurface[]>();
  private pending = new Map<number, Pending>();
  constructor(
    private makeWorker = () =>
      new Worker(new URL("./raster.worker.ts", import.meta.url), { type: "module" })
  ) {}
  private send(message: TileMessage) {
    if (!this.worker) {
      this.worker = this.makeWorker();
      this.worker.onmessage = (event: MessageEvent<TileReply>) => this.receive(event.data);
      this.worker.onerror = (event) => {
        for (const item of this.pending.values()) {
          item.cleanup();
          item.reject(new Error(event.message));
        }
        this.pending.clear();
      };
    }
    this.worker.postMessage(message);
  }
  private receive(reply: TileReply) {
    const item = this.pending.get(reply.request);
    if (!item) return;
    this.pending.delete(reply.request);
    item.cleanup();
    if ("error" in reply) item.reject(new Error(reply.error));
    else item.resolve(reply.values);
  }
  private grid(grid: GridSurface) {
    let entry = this.grids.get(grid);
    if (!entry) {
      entry = { id: ++this.sequence, users: 0 };
      this.grids.set(grid, entry);
      this.send({ kind: "grid", id: entry.id, grid });
    }
    entry.users++;
    return entry.id;
  }
  register(raster: Raster) {
    const id = ++this.sequence;
    const used = [
      raster.field,
      ...(raster.water ? [raster.water] : []),
      ...(raster.ice ? [raster.ice] : []),
    ];
    const field = this.grid(raster.field),
      water = raster.water ? this.grid(raster.water) : undefined,
      ice = raster.ice ? this.grid(raster.ice) : undefined;
    this.rasters.set(id, used);
    this.send({ kind: "raster", id, raster: { ...raster, field, water, ice } });
    return id;
  }
  load(raster: number, extent: number[], size: number, signal: AbortSignal) {
    if (signal.aborted || !this.rasters.has(raster))
      return Promise.reject(new DOMException("Tile cancelled", "AbortError"));
    const request = ++this.sequence;
    return new Promise<Float32Array>((resolve, reject) => {
      const abort = () => {
        this.pending.delete(request);
        signal.removeEventListener("abort", abort);
        this.send({ kind: "cancel", request });
        reject(new DOMException("Tile cancelled", "AbortError"));
      };
      this.pending.set(request, {
        raster,
        resolve,
        reject,
        cleanup: () => signal.removeEventListener("abort", abort),
      });
      signal.addEventListener("abort", abort, { once: true });
      this.send({ kind: "tile", id: raster, request, extent, size });
    });
  }
  release(id: number) {
    const used = this.rasters.get(id);
    if (!used) return;
    this.rasters.delete(id);
    const grids: number[] = [];
    for (const grid of used) {
      const entry = this.grids.get(grid)!;
      if (--entry.users === 0) {
        grids.push(entry.id);
        this.grids.delete(grid);
      }
    }
    for (const [request, item] of this.pending)
      if (item.raster === id) {
        item.cleanup();
        item.reject(new DOMException("Raster replaced", "AbortError"));
        this.pending.delete(request);
      }
    this.send({ kind: "release", id, grids });
  }
  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const item of this.pending.values()) {
      item.cleanup();
      item.reject(new DOMException("Map closed", "AbortError"));
    }
    this.pending.clear();
    this.rasters.clear();
    this.grids.clear();
  }
}
