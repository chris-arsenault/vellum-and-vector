import type { MapRef } from "./generated";
import type { EditCommand, EditHistory, EditOutcome } from "./generatedEditing";
import type { NewMapRequest, TerrainEdit, TerrainOutcome } from "./generatedAuthoring";
import type { ReadOptions } from "./services";

/** Real-scale and authored-map authoring runs on the host that owns the map catalogue
 * (ADR 0016, ADR 0019). */
export interface MapEditing {
  /** A blank all-ocean map to author (ADR 0019). */
  newMap(request: NewMapRequest, options?: ReadOptions): Promise<MapRef>;
  /** Shape an authored map's terrain; the raster is rewritten in place. */
  terrain(reference: MapRef, edit: TerrainEdit, options?: ReadOptions): Promise<TerrainOutcome>;
  undoTerrain(reference: MapRef, options?: ReadOptions): Promise<TerrainOutcome>;
  redoTerrain(reference: MapRef, options?: ReadOptions): Promise<TerrainOutcome>;
  edit(reference: MapRef, command: EditCommand, options?: ReadOptions): Promise<EditOutcome>;
  undo(reference: MapRef, options?: ReadOptions): Promise<EditOutcome>;
  redo(reference: MapRef, options?: ReadOptions): Promise<EditOutcome>;
  history(reference: MapRef, options?: ReadOptions): Promise<EditHistory>;
  /** The floors map of a building on a real-scale ground map, made on first opening. */
  openFloors(parent: MapRef, buildingId: string, options?: ReadOptions): Promise<MapRef>;
}
