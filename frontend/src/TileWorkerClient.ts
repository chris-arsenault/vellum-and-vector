import { detachGrid, type GridSurface } from "@atlas/domain";
import { resourceRaster, type Raster } from "./types";
import type { TileMessage, TileReply } from "./tileProtocol";
import { connectAtlasWorker } from "./connectAtlasWorker";

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
  private connection: Promise<void> | undefined;
  private failed: Error | undefined;
  constructor(
    private makeWorker = () =>
      new Worker(new URL("./raster.worker.ts", import.meta.url), { type: "module" }),
    private connect = connectAtlasWorker
  ) {}
  private send(message: TileMessage) {
    if (!this.worker) {
      this.worker = this.makeWorker();
      this.worker.onmessage = (event: MessageEvent<TileReply>) => this.receive(event.data);
      this.worker.onerror = (event) => this.fail(new Error(event.message));
    }
    const worker = this.worker;
    if (message.kind === "resourceRaster" && !this.connection)
      this.connection = this.connect(worker);
    if (this.connection)
      void this.connection.then(
        () => worker.postMessage(message),
        (error: Error) => this.fail(error)
      );
    else worker.postMessage(message);
  }
  private fail(error: Error) {
    this.failed = error;
    for (const item of this.pending.values()) {
      item.cleanup();
      item.reject(error);
    }
    this.pending.clear();
  }
  private receive(reply: TileReply) {
    if ("kind" in reply) return;
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
      this.send({ kind: "grid", id: entry.id, grid: detachGrid(grid) });
    }
    entry.users++;
    return entry.id;
  }
  register(raster: Raster) {
    const id = ++this.sequence;
    if (resourceRaster(raster)) {
      this.rasters.set(id, []);
      this.send({ kind: "resourceRaster", id, raster });
      return id;
    }
    const used = [
      raster.field,
      ...(raster.water ? [raster.water] : []),
      ...(raster.ice ? [raster.ice] : []),
      ...(raster.surface ? [raster.surface] : []),
    ];
    const field = this.grid(raster.field),
      water = raster.water ? this.grid(raster.water) : undefined,
      ice = raster.ice ? this.grid(raster.ice) : undefined,
      surface = raster.surface ? this.grid(raster.surface) : undefined;
    this.rasters.set(id, used);
    this.send({ kind: "raster", id, raster: { ...raster, field, water, ice, surface } });
    return id;
  }
  /** Re-send a resource raster whose geography changed; its inputs stay open in the worker. */
  update(id: number, raster: Raster) {
    if (!resourceRaster(raster) || !this.rasters.has(id)) return;
    this.send({ kind: "resourceRaster", id, raster });
  }
  load(raster: number, extent: number[], size: number, signal: AbortSignal) {
    if (this.failed) return Promise.reject(this.failed);
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
  /** Tiles requested and not yet answered. */
  get busy() {
    return this.pending.size;
  }
  dispose() {
    const worker = this.worker;
    if (worker) {
      worker.onmessage = (event: MessageEvent<TileReply>) => {
        if ("kind" in event.data && event.data.kind === "closed") worker.terminate();
      };
      if (this.connection)
        void this.connection.then(
          () => worker.postMessage({ kind: "close" } satisfies TileMessage),
          () => worker.terminate()
        );
      else worker.postMessage({ kind: "close" } satisfies TileMessage);
    }
    this.worker = null;
    this.connection = undefined;
    for (const item of this.pending.values()) {
      item.cleanup();
      item.reject(new DOMException("Map closed", "AbortError"));
    }
    this.pending.clear();
    this.rasters.clear();
    this.grids.clear();
  }
}

/** Tile workers beside the page's own thread and the workspace worker. */
export function tileWorkerCount(cores = globalThis.navigator?.hardwareConcurrency ?? 2) {
  return Math.max(1, Math.min(4, cores - 2));
}
export type TileClient = Pick<
  TileWorkerClient,
  "register" | "update" | "load" | "release" | "dispose"
>;

/**
 * Tiles drawn by several workers at once. Every worker registers every raster; a tile goes
 * to the worker with the fewest tiles outstanding.
 */
export class TileWorkerPool implements TileClient {
  private sequence = 0;
  private registrations = new Map<number, number[]>();
  constructor(
    private clients: TileWorkerClient[] = Array.from(
      { length: tileWorkerCount() },
      () => new TileWorkerClient()
    )
  ) {}
  register(raster: Raster) {
    const id = ++this.sequence;
    this.registrations.set(
      id,
      this.clients.map((client) => client.register(raster))
    );
    return id;
  }
  update(id: number, raster: Raster) {
    this.registrations.get(id)?.forEach((own, k) => this.clients[k].update(own, raster));
  }
  load(id: number, extent: number[], size: number, signal: AbortSignal) {
    const owns = this.registrations.get(id);
    if (!owns) return Promise.reject(new DOMException("Tile cancelled", "AbortError"));
    let chosen = 0;
    this.clients.forEach((client, k) => {
      if (client.busy < this.clients[chosen].busy) chosen = k;
    });
    return this.clients[chosen].load(owns[chosen], extent, size, signal);
  }
  release(id: number) {
    this.registrations.get(id)?.forEach((own, k) => this.clients[k].release(own));
    this.registrations.delete(id);
  }
  dispose() {
    for (const client of this.clients) client.dispose();
    this.registrations.clear();
  }
}
