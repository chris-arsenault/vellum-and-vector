import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { createGrid, putChannel, type ResourceReference } from "@atlas/domain";
import { testDatabase } from "./testDatabase";
import { seedSpatialWorld } from "./dal/spatialFixtures";
import { Database } from "./dal/database";
import { writeGrid } from "./dal/gridWriter";
import { readFieldArtifact, loadField } from "./dal/fieldArtifacts";

it("replaces prototype storage under the application role while retaining authored numerical identities and samples", async () => {
  const db = await testDatabase(33);
  try {
    const database = new Database(db.client);
    const { world, root } = await database.transaction(seedSpatialWorld);
    const scope = {
      worldId: world.id,
      areaId: root.id,
      spaceId: world.id,
      footprint: root.footprint,
      crsId: world.reference.id,
      time: "present",
      revision: 1,
      resolution: null,
    };
    const grid = createGrid(randomUUID(), scope, 3, 3);
    putChannel(
      grid,
      "elevation",
      "metre",
      Float64Array.from({ length: 9 }, (_, i) => i * 10)
    );
    const reference: ResourceReference = {
      id: randomUUID(),
      kind: "field",
      schemaId: "atlas.grid",
      schemaVersion: 1,
      revision: "authored-v1",
      scope: grid.scope,
      unit: "grid",
      facts: ["elevation"],
      lineage: [],
    };
    await database.transaction(async (sql) => {
      await writeGrid(sql, world.id, grid);
      await sql.query(
        `INSERT INTO atlas_resources(id,world_id,kind,revision,area_id,space_id,footprint,crs_id,time_context,
        resolution,unit,grid_id,status,content_hash,schema_id,schema_version,source_version,published_version,sealed)
        VALUES($1,$2,'field',$3,$4,$2,ST_SetSRID(ST_GeomFromGeoJSON($5),0),$6,'present',$7,'grid',$8,'published','old-hash','atlas.grid',1,1,1,false)`,
        [
          reference.id,
          world.id,
          reference.revision,
          scope.areaId,
          JSON.stringify(scope.footprint),
          scope.crsId,
          grid.scope.resolution,
          grid.id,
        ]
      );
      await sql.query("INSERT INTO atlas_resource_facts VALUES($1,'elevation')", [reference.id]);
      await sql.query("UPDATE atlas_resources SET sealed=true WHERE id=$1", [reference.id]);
    });
    await db.client.query(await readFile("db/migrations/034_generation_storage.sql", "utf8"));
    const artifact = await readFieldArtifact(db.client, world.id, reference.id, 1);
    expect(artifact.gridId).toBe(grid.id);
    expect(artifact.reference.id).toBe(reference.id);
    expect(artifact.reference.facts).toEqual(reference.facts);
    expect((await loadField(db.client, artifact.reference, 1)).channels.elevation).toEqual(
      grid.channels.elevation
    );
    await expect(
      db.client.query("UPDATE atlas_field_artifacts SET revision='changed' WHERE id=$1", [
        reference.id,
      ])
    ).rejects.toThrow("immutable");
  } finally {
    await db.close();
  }
});
