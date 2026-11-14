import type { MapRef, MapNavigationState, NavigationStore } from "@atlas/map";
import type { SqlReader } from "./database";

export class PostgresNavigationStore implements NavigationStore {
  constructor(private database: SqlReader) {}
  async read(reference: MapRef): Promise<MapNavigationState> {
    const { rows } = await this.database.query<{ data: MapNavigationState }>(
      "SELECT data FROM map.navigation WHERE map_id=$1 AND revision=$2",
      [reference.mapId, reference.revision]
    );
    return rows[0]?.data ?? { version: 0, regions: [], views: [] };
  }
  async write(reference: MapRef, expected: number, state: MapNavigationState) {
    const { rows } = await this.database.query(
      `INSERT INTO map.navigation(map_id,revision,version,data)
       SELECT $1,$2,$3,$4::jsonb WHERE $5::integer=0 OR EXISTS(SELECT 1 FROM map.navigation WHERE map_id=$1 AND revision=$2)
       ON CONFLICT(map_id,revision) DO UPDATE SET version=excluded.version,data=excluded.data WHERE map.navigation.version=$5
       RETURNING version`,
      [reference.mapId, reference.revision, state.version, JSON.stringify(state), expected]
    );
    if (rows.length !== 1) throw new Error("Map regions or views changed. Reload before saving.");
  }
}
