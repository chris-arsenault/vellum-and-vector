import type { MapLibrary, MapRef, ReadOptions, SaveMapRequest } from "@atlas/map";

interface Arguments {
  list: [string | undefined];
  open: [string];
  find: [string];
  save: [SaveMapRequest];
  related: [MapRef];
}
type Method = keyof Arguments;
export type LibraryCall = { [M in Method]: { method: M; args: Arguments[M] } }[Method];
export type LibraryTransport = (call: LibraryCall, options?: ReadOptions) => Promise<unknown>;

export class RpcMapLibrary implements MapLibrary {
  constructor(private send: LibraryTransport) {}
  private call<M extends Method>(method: M, args: Arguments[M], options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    return this.send({ method, args } as LibraryCall, options) as ReturnType<MapLibrary[M]>;
  }
  list(cursor?: string, options?: ReadOptions) {
    return this.call("list", [cursor], options);
  }
  open(mapId: string, options?: ReadOptions) {
    return this.call("open", [mapId], options);
  }
  find(mapId: string, options?: ReadOptions) {
    return this.call("find", [mapId], options);
  }
  save(request: SaveMapRequest, options?: ReadOptions) {
    return this.call("save", [request], options);
  }
  related(reference: MapRef, options?: ReadOptions) {
    return this.call("related", [reference], options);
  }
}

export async function dispatchMapLibrary(
  library: MapLibrary,
  input: unknown,
  options?: ReadOptions
) {
  if (!input || typeof input !== "object") throw new Error("A map library request is required.");
  const call = input as Partial<LibraryCall>;
  if (
    !call.method ||
    !Object.hasOwn({ list: 1, open: 1, find: 1, save: 1, related: 1 }, call.method) ||
    !Array.isArray(call.args) ||
    call.args.length !== 1
  )
    throw new Error("Unknown map library operation or arguments.");
  options?.signal?.throwIfAborted();
  const method = library[call.method] as (...args: unknown[]) => Promise<unknown>;
  return method.apply(library, [...call.args, options]);
}
