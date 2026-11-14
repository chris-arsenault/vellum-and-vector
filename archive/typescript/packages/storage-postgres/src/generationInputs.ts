import type { MapRef } from "@atlas/map";
import type { SqlReader } from "./database";

export interface BackendCompletedInputs {
  reference: MapRef;
  worldId: string;
  areaId: string;
  revision: number;
  catalogId: string;
}

/** Only the generation host receives this capability and its private catalog identities. */
export class PostgresGenerationInputs {
  constructor(private db: SqlReader) {}
  async bind(input: BackendCompletedInputs) {
    await this.db.query(`INSERT INTO generation.inputs VALUES($1,$2,$3,$4,$5,$6)`, [
      input.reference.mapId,
      input.reference.revision,
      input.worldId,
      input.areaId,
      input.revision,
      input.catalogId,
    ]);
  }
  async read(reference: MapRef): Promise<BackendCompletedInputs> {
    const { rows } = await this.db.query<{
      world_id: string;
      area_id: string;
      revision: string;
      catalog_id: string;
    }>("SELECT * FROM generation.inputs WHERE map_id=$1 AND map_revision=$2", [
      reference.mapId,
      reference.revision,
    ]);
    if (!rows[0]) throw new Error("This map revision has no completed inputs.");
    const row = rows[0];
    return {
      reference,
      worldId: row.world_id,
      areaId: row.area_id,
      revision: Number(row.revision),
      catalogId: row.catalog_id,
    };
  }
  async atVersion(worldId: string, areaId: string, revision: number): Promise<MapRef> {
    const { rows } = await this.db.query<{ map_id: string; map_revision: string }>(
      `SELECT map_id,map_revision FROM generation.inputs
       WHERE world_id=$1 AND area_id=$2 AND revision<=$3 ORDER BY revision DESC,map_revision DESC LIMIT 1`,
      [worldId, areaId, revision]
    );
    if (!rows[0]) throw new Error("The parent has no completed map at this revision.");
    return { mapId: rows[0].map_id, revision: rows[0].map_revision };
  }
  async unbind(reference: MapRef) {
    await this.db.query("DELETE FROM generation.inputs WHERE map_id=$1 AND map_revision=$2", [
      reference.mapId,
      reference.revision,
    ]);
  }
}
