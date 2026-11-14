import type { BrowserMapStore } from "@atlas/engine";

/** A map capability exposes Rust operations, without constructing storage or generation hosts. */
export function mapCall<T>(store: BrowserMapStore, method: string, params: unknown): T {
  return JSON.parse(store.execute(JSON.stringify({ method, params }))) as T;
}
