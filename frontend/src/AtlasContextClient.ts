import type { ReadOptions } from "@atlas/map";
import type { AtlasCall, AtlasReply } from "./atlasContextProtocol";

/** One worker owns local storage and computation. UI requests carry facade contracts only. */
export class AtlasContextClient {
  private sequence = 0;
  private failed: Error | null = null;
  private pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: unknown): void }
  >();
  constructor(private worker: Worker) {
    worker.onmessage = ({ data }: MessageEvent<AtlasReply>) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if ("error" in data) pending.reject(new Error(data.error));
      else pending.resolve(data.value);
    };
    worker.onerror = (event) => this.fail(new Error(event.message));
    worker.onmessageerror = () => this.fail(new Error("Could not read the atlas worker response."));
  }
  request(operation: AtlasCall, options?: ReadOptions): Promise<unknown> {
    options?.signal?.throwIfAborted();
    if (this.failed) return Promise.reject(this.failed);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        reject(options?.signal?.reason);
      };
      const clean = () => options?.signal?.removeEventListener("abort", abort);
      this.pending.set(id, {
        resolve(value) {
          clean();
          resolve(value);
        },
        reject(error) {
          clean();
          reject(error);
        },
      });
      options?.signal?.addEventListener("abort", abort, { once: true });
      this.worker.postMessage({ id, operation });
    });
  }
  private fail(error: Error) {
    this.failed = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
  async close() {
    try {
      await this.request({ service: "close" });
    } finally {
      this.worker.terminate();
      this.fail(new Error("Atlas context closed."));
    }
  }
}
