import { expect, it } from "vitest";
import { rectangle, spatial, type SpatialScope } from "@atlas/domain";
import { readFile } from "node:fs/promises";
import { testDatabase } from "../testDatabase";
import { Database } from "./database";
import { seedSpatialWorld, fixtureComposed } from "./spatialFixtures";
import { readAreas } from "./areaReader";
import { readFeatures } from "./objectReaders";
import { readWorldHeader, writeWorldHeader } from "./worldHeader";
import { allocateRevisions, closeRevisions } from "./revisions";
import { writeFeatureBases } from "./objectWriters";
import { writeRepresentations } from "./representations";
import { querySpatialPage, writeSpatialRows } from "./spatialRows";

it("retains located boundary inputs, typed attribute shapes and independently versioned detail", async () => {
  const db = await testDatabase();
  try {
    const database = new Database(db.client),
      fixture = await database.transaction(seedSpatialWorld);
    const { world, root, child, feature, detail } = fixture;
    const header = await readWorldHeader(db.client, world.id, 1);
    expect(header.epochs).toEqual(world.epochs);
    const areas = await readAreas(db.client, world.id, 1, [root.id, child.id]);
    expect(areas.objects[child.id].boundary?.samples).toEqual(child.boundary?.samples);
    expect(areas.objects[child.id].boundary?.rings).toEqual(child.boundary?.rings);
    expect(areas.objects[child.id].traits).toEqual(child.traits);
    const before = await readFeatures(db.client, world.id, 1, [feature.id]);
    expect(before.objects[feature.id].attributes).toEqual(feature.attributes);
    expect(before.objects[feature.id].detail[child.id].attributes).toEqual(detail.attributes);
    await database.transaction(async (sql) => {
      await writeWorldHeader(sql, { ...world, version: 2 });
      await sql.query("UPDATE atlas_worlds SET version=2 WHERE id=$1", [world.id]);
      await closeRevisions(sql, world.id, 2, "feature", [feature.id]);
      const revisions = await allocateRevisions(sql, world.id, [feature.id]);
      await writeFeatureBases(sql, world.id, 2, [
        { revision: revisions.get(feature.id)!, value: { ...feature, name: "Named river" } },
      ]);
      await writeSpatialRows(
        sql,
        world.id,
        2,
        [feature.id],
        [fixtureComposed(world.id, feature, detail)]
      );
    });
    const after = await readFeatures(db.client, world.id, 2, [feature.id]);
    expect(after.objects[feature.id].name).toBe("Named river");
    expect(after.objects[feature.id].detail[child.id]).toEqual(
      before.objects[feature.id].detail[child.id]
    );
    expect(
      (
        await db.client.query(
          "SELECT count(*)::int AS count FROM atlas_representations WHERE feature_id=$1",
          [feature.id]
        )
      ).rows[0].count
    ).toBe(1);
    const narrow = await readFeatures(db.client, world.id, 2, [feature.id], {
      spaceId: world.id,
      footprint: rectangle([0, 0, 10, 10]),
    });
    expect(narrow.objects[feature.id].detail).toEqual({});
    const rollback = await readFile(
      new URL("../../../db/migrations/rollback/013_representation_revisions.sql", import.meta.url),
      "utf8"
    );
    await expect(db.client.query(rollback)).rejects.toThrow("explicit downgrade transition");
  } finally {
    await db.close();
  }
});

it("keeps pinned composed geometry when one protected detail patch is revised", async () => {
  const db = await testDatabase();
  try {
    const database = new Database(db.client),
      { world, child, feature, detail } = await database.transaction(seedSpatialWorld);
    const scope: SpatialScope = {
      worldId: world.id,
      areaId: child.id,
      spaceId: world.id,
      footprint: child.footprint,
      crsId: world.reference.id,
      revision: 1,
      time: "present",
      resolution: null,
    };
    const before = await querySpatialPage(db.client, scope, ["rivers"], { offset: 0, limit: 1 });
    const changed = {
      ...detail,
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [20, 50],
          [35, 40],
          [65, 60],
          [80, 50],
        ],
      },
    };
    await database.transaction(async (sql) => {
      await writeWorldHeader(sql, { ...world, version: 2 });
      await sql.query("UPDATE atlas_worlds SET version=2 WHERE id=$1", [world.id]);
      await closeRevisions(sql, world.id, 2, "representation", [detail.id]);
      const revisions = await allocateRevisions(sql, world.id, [detail.id]);
      await writeRepresentations(sql, world.id, 2, [
        { revision: revisions.get(detail.id)!, value: changed },
      ]);
      await writeSpatialRows(
        sql,
        world.id,
        2,
        [feature.id],
        [fixtureComposed(world.id, feature, changed)]
      );
    });
    expect(
      (await querySpatialPage(db.client, scope, ["rivers"], { offset: 0, limit: 1 })).items
    ).toEqual(before.items);
    const current = await querySpatialPage(db.client, { ...scope, revision: 2 }, ["rivers"], {
      offset: 0,
      limit: 1,
    });
    expect(current.items[0].geometry).not.toEqual(before.items[0].geometry);
    expect(spatial.crossings(changed.geometry, child.footprint)).toEqual(
      spatial.crossings(detail.geometry, child.footprint)
    );
    const wrongSpace = await querySpatialPage(db.client, { ...scope, spaceId: child.id }, [], {
      offset: 0,
      limit: 1,
    });
    expect(wrongSpace.total).toBe(0);
  } finally {
    await db.close();
  }
});

it("retains boundary and trait values through the supported composite-to-relational transition", async () => {
  const db = await testDatabase();
  try {
    const { world, root, child } = await new Database(db.client).transaction(seedSpatialWorld);
    const before = await readAreas(db.client, world.id, 1, [root.id, child.id]);
    await db.client.query(
      await readFile(
        new URL("../../../db/migrations/rollback/026_boundary_measurements.sql", import.meta.url),
        "utf8"
      )
    );
    await db.client.query(
      await readFile(
        new URL("../../../db/migrations/rollback/011_boundary_relations.sql", import.meta.url),
        "utf8"
      )
    );
    await db.client.query(
      await readFile(
        new URL("../../../db/migrations/011_boundary_relations.sql", import.meta.url),
        "utf8"
      )
    );
    await db.client.query(
      await readFile(
        new URL("../../../db/migrations/026_boundary_measurements.sql", import.meta.url),
        "utf8"
      )
    );
    expect((await readAreas(db.client, world.id, 1, [root.id, child.id])).objects).toEqual(
      before.objects
    );
  } finally {
    await db.close();
  }
});
