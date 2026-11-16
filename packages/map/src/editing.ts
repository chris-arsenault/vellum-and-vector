import type { EditCommand, EditHistory, EditOutcome, MapRef } from "./generated";
import type { ReadOptions } from "./services";

/** Real-scale authoring runs on the host that owns the map catalogue (ADR 0016). */
export interface MapEditing {
  edit(reference: MapRef, command: EditCommand, options?: ReadOptions): Promise<EditOutcome>;
  undo(reference: MapRef, options?: ReadOptions): Promise<EditOutcome>;
  redo(reference: MapRef, options?: ReadOptions): Promise<EditOutcome>;
  history(reference: MapRef, options?: ReadOptions): Promise<EditHistory>;
}
