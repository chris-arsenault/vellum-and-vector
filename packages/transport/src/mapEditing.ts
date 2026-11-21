import type {
  EditCommand,
  MapEditing,
  MapRef,
  NewMapRequest,
  ReadOptions,
  TerrainEdit,
} from "@atlas/map";

interface Arguments {
  newMap: [NewMapRequest];
  terrain: [MapRef, TerrainEdit];
  undoTerrain: [MapRef];
  redoTerrain: [MapRef];
  edit: [MapRef, EditCommand];
  undo: [MapRef];
  redo: [MapRef];
  history: [MapRef];
  openFloors: [MapRef, string];
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
  newMap(request: NewMapRequest, options?: ReadOptions) {
    return this.call("newMap", [request], options);
  }
  terrain(reference: MapRef, edit: TerrainEdit, options?: ReadOptions) {
    return this.call("terrain", [reference, edit], options);
  }
  undoTerrain(reference: MapRef, options?: ReadOptions) {
    return this.call("undoTerrain", [reference], options);
  }
  redoTerrain(reference: MapRef, options?: ReadOptions) {
    return this.call("redoTerrain", [reference], options);
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
  openFloors(parent: MapRef, buildingId: string, options?: ReadOptions) {
    return this.call("openFloors", [parent, buildingId], options);
  }
  history(reference: MapRef, options?: ReadOptions) {
    return this.call("history", [reference], options);
  }
}
