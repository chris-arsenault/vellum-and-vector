import type { EditCommand, MapEditing, MapRef, ReadOptions } from "@atlas/map";

interface Arguments {
  edit: [MapRef, EditCommand];
  undo: [MapRef];
  redo: [MapRef];
  history: [MapRef];
}
type Method = keyof Arguments;
export type EditingCall = { [M in Method]: { method: M; args: Arguments[M] } }[Method];
export type EditingTransport = (call: EditingCall, options?: ReadOptions) => Promise<unknown>;

/** Authoring calls cross the facade unchanged; the owning host's Rust store runs them. */
export class RpcMapEditing implements MapEditing {
  constructor(private send: EditingTransport) {}
  private call<M extends Method>(method: M, args: Arguments[M], options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    return this.send({ method, args } as EditingCall, options) as ReturnType<MapEditing[M]>;
  }
  edit(reference: MapRef, command: EditCommand, options?: ReadOptions) {
    return this.call("edit", [reference, command], options);
  }
  undo(reference: MapRef, options?: ReadOptions) {
    return this.call("undo", [reference], options);
  }
  redo(reference: MapRef, options?: ReadOptions) {
    return this.call("redo", [reference], options);
  }
  history(reference: MapRef, options?: ReadOptions) {
    return this.call("history", [reference], options);
  }
}
