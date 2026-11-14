import type { Database } from "./catalogDatabase";
import type { MapRef } from "@atlas/map";
import { requireThat } from "@atlas/domain";
import type { CatalogRoot } from "./catalogPool";

export interface CompletedInputs {
  reference: MapRef;
  worldId: string;
  areaId: string;
  revision: number;
  root: CatalogRoot;
}

/** Private generation ownership. Finished map readers never receive catalog roots. */
export class GenerationInputs {
  constructor(private db: Database) {}

  bind(input: CompletedInputs) {
    const world = this.db.selectObject("SELECT revision,data FROM worlds WHERE id=?", [
      input.worldId,
    ]);
    requireThat(
      world && Number(world.revision) === input.revision,
      "stale_version",
      "The geography changed before its completed inputs were retained."
    );
    requireThat(
      !JSON.parse(String(world.data)).publication,
      "incomplete_generation",
      "Complete the geography before retaining generation inputs."
    );
    requireThat(
      this.db.selectValue("SELECT 1 FROM records_core WHERE world_id=? AND kind='area' AND id=?", [
        input.worldId,
        input.areaId,
      ]),
      "missing_area",
      "Choose an existing mapped area."
    );
    this.db.exec({
      sql: `INSERT INTO generation_inputs
        (map_id,map_revision,world_id,area_id,revision,root_name,root_path)
        VALUES(?,?,?,?,?,?,?)`,
      bind: [
        input.reference.mapId,
        input.reference.revision,
        input.worldId,
        input.areaId,
        input.revision,
        input.root.name,
        input.root.path,
      ],
    });
  }

  read(reference: MapRef): CompletedInputs {
    const row = this.db.selectObject(
      "SELECT * FROM generation_inputs WHERE map_id=? AND map_revision=?",
      [reference.mapId, reference.revision]
    );
    requireThat(row, "missing_generation_inputs", "This map revision has no completed inputs.");
    return {
      reference,
      worldId: String(row.world_id),
      areaId: String(row.area_id),
      revision: Number(row.revision),
      root: { name: String(row.root_name), path: String(row.root_path) },
    };
  }

  atVersion(worldId: string, areaId: string, revision: number): MapRef {
    const row = this.db.selectObject(
      `SELECT map_id,map_revision FROM generation_inputs
       WHERE world_id=? AND area_id=? AND revision<=? ORDER BY revision DESC,rowid DESC LIMIT 1`,
      [worldId, areaId, revision]
    );
    requireThat(
      row,
      "missing_generation_inputs",
      "The parent has no completed map at this revision."
    );
    return { mapId: String(row.map_id), revision: String(row.map_revision) };
  }

  /** The publication host calls this only when finishing the new map failed. */
  unbind(reference: MapRef) {
    this.db.exec({
      sql: "DELETE FROM generation_inputs WHERE map_id=? AND map_revision=?",
      bind: [reference.mapId, reference.revision],
    });
  }
}

export async function retainCompletedInputs(
  inputs: GenerationInputs,
  snapshot: () => Promise<CatalogRoot>,
  input: Omit<CompletedInputs, "root">
) {
  const retained = { ...input, root: await snapshot() };
  inputs.bind(retained);
  return retained;
}
