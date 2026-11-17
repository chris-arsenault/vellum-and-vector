import type { MapRef } from "./generated";
import type { EditCommand, EditHistory, EditOutcome } from "./generatedEditing";
import type { ReadOptions } from "./services";

/** Real-scale authoring runs on the host that owns the map catalogue (ADR 0016). */
export interface MapEditing {
  edit(reference: MapRef, command: EditCommand, options?: ReadOptions): Promise<EditOutcome>;
  undo(reference: MapRef, options?: ReadOptions): Promise<EditOutcome>;
  redo(reference: MapRef, options?: ReadOptions): Promise<EditOutcome>;
  history(reference: MapRef, options?: ReadOptions): Promise<EditHistory>;
  /** The floors map of a building on a real-scale ground map, made on first opening. */
  openFloors(parent: MapRef, buildingId: string, options?: ReadOptions): Promise<MapRef>;
}
