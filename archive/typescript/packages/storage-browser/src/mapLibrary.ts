import type { Database } from "./catalogDatabase";
import {
  savedMapDocument,
  type MapLibrary,
  type MapRef,
  type ReadOptions,
  type SavedMapDocument,
  type SaveMapRequest,
  type MapNavigationState,
} from "@atlas/map";
import type { MapCatalog } from "./mapCatalog";

const pageSize = 256;

/** Explicit saved roots are separate from publication heads and working presentation. */
export class BrowserMapLibrary implements MapLibrary {
  constructor(
    private db: Database,
    private maps: MapCatalog
  ) {}

  async list(cursor = "", options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    const rows = this.db.selectObjects(
      "SELECT data FROM map_saved WHERE map_id>? ORDER BY map_id LIMIT ?",
      [cursor, pageSize + 1]
    );
    const items = rows.slice(0, pageSize).map((row) => {
      const { reference, name, savedAt, version } = JSON.parse(
        String(row.data)
      ) as SavedMapDocument;
      return { reference, name, savedAt, version };
    });
    return { items, next: rows.length > pageSize ? items.at(-1)!.reference.mapId : null };
  }

  async open(mapId: string, options?: ReadOptions): Promise<SavedMapDocument> {
    options?.signal?.throwIfAborted();
    const data = this.db.selectValue("SELECT data FROM map_saved WHERE map_id=?", [mapId]);
    if (typeof data !== "string") throw new Error("Saved map was not found.");
    return JSON.parse(data) as SavedMapDocument;
  }

  async save(request: SaveMapRequest, options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    return this.db.transaction(() => {
      const { reference } = request;
      const previous = this.db.selectValue("SELECT version FROM map_saved WHERE map_id=?", [
        reference.mapId,
      ]);
      const held = this.db.selectValue(
        "SELECT data FROM map_navigation WHERE map_id=? AND revision=?",
        [reference.mapId, reference.revision]
      );
      const navigation: MapNavigationState =
        typeof held === "string" ? JSON.parse(held) : { version: 0, regions: [], views: [] };
      const saved = savedMapDocument(
        this.maps.open(reference),
        navigation,
        request,
        previous === undefined ? null : Number(previous),
        new Date().toISOString()
      );
      this.db.exec({
        sql: `INSERT INTO map_saved VALUES(?,?,?,?) ON CONFLICT(map_id) DO UPDATE
          SET revision=excluded.revision,version=excluded.version,data=excluded.data`,
        bind: [reference.mapId, reference.revision, saved.version, JSON.stringify(saved)],
      });
      return saved;
    });
  }

  async related(reference: MapRef, options?: ReadOptions) {
    options?.signal?.throwIfAborted();
    const map = this.maps.open(reference);
    const rows = this.db.selectObjects(
      `SELECT m.map_id,m.revision FROM maps m JOIN map_heads h USING(map_id,revision)
       WHERE json_extract(descriptor,'$.parent.mapId')=?
       AND json_extract(descriptor,'$.parent.revision')=? ORDER BY m.map_id`,
      [reference.mapId, reference.revision]
    );
    return {
      parent: map.parent,
      children: rows.map((row) => ({ mapId: String(row.map_id), revision: String(row.revision) })),
    };
  }
}
