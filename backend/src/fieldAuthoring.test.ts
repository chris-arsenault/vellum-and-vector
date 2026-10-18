import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  createIntentRegistry,
  intentReads,
  FactDependencies,
  sample,
  type Intent,
  type SpatialScope,
  valueRecordSchema,
  rectangle,
} from "@atlas/domain";
import { testDatabase } from "./testDatabase";
import { Database } from "./dal/database";
import { seedSpatialWorld } from "./dal/spatialFixtures";
import { IntentService } from "./intentService";
import { ProjectionRepository } from "./dal/projections";
import { UndoRepository } from "./dal/undo";

function edit(scope: SpatialScope, kind: string, data: unknown): Intent {
  return {
    scope,
    kind,
    data: valueRecordSchema.parse(data),
    operationId: randomUUID(),
    version: 1,
    expectedVersion: scope.revision,
  };
}
function reads(scope: SpatialScope, field: string) {
  return intentReads(
    {
      scope,
      owner: "alice",
      actor: "user:alice",
      operationId: randomUUID(),
      layers: [],
      fields: [],
      facts: new FactDependencies(),
    },
    {
      objects: [{ kind: "field", ids: [field] }],
      channels: [{ fieldId: field, names: ["elevation"] }],
    }
  );
}
it("reconciles a coarse field without discarding authored patches and rejects traits contradicting effective samples", async () => {
  const db = await testDatabase();
  try {
    const database = new Database(db.client),
      { world, root, service, field, scope } = await seedField(database);
    await service.commit(
      world.id,
      "alice",
      edit(scope, "sculptField", {
        fieldId: field,
        center: { x: 50, y: 50, z: 0 },
        radius: 20,
        channel: "elevation",
        mode: "set",
        amount: 110,
      })
    );
    const current = { ...scope, revision: 4 };
    await expect(
      service.commit(
        world.id,
        "alice",
        edit(current, "setTraits", {
          areaId: root.id,
          traits: [
            {
              field: "terrain.elevation",
              kind: "hard",
              minimum: 100,
              maximum: 105,
              cause: null,
              scope: null,
            },
          ],
        })
      )
    ).rejects.toMatchObject({ code: "field_trait_conflict" });
    const operation = edit(current, "reconcileField", {
      id: field,
      areaId: root.id,
      layerId: "terrain",
      footprint: root.footprint,
      width: 11,
      height: 11,
      channels: { elevation: { unit: "metre", values: 200 } },
    });
    const preview = await service.preview(world.id, "alice", operation);
    expect(sample(preview.fields[field], "elevation", { x: 50, y: 50, z: 0 })).toBe(110);
    await expect(service.commit(world.id, "alice", operation)).rejects.toMatchObject({
      code: "confirmation_required",
    });
    await service.commit(world.id, "alice", { ...operation, confirmed: true });
    const after = await new ProjectionRepository(database).read(
      world.id,
      "alice",
      reads({ ...scope, revision: 5 }, field)
    );
    expect(sample(after.numerical[field], "elevation", { x: 50, y: 50, z: 0 })).toBe(110);
    expect(sample(after.numerical[field], "elevation", { x: 0, y: 0, z: 0 })).toBe(200);
    expect(after.fieldPatches).toHaveLength(1);
  } finally {
    await db.close();
  }
});
async function seedField(database: Database) {
  const { world, root, child } = await database.transaction(seedSpatialWorld);
  const service = new IntentService(database, createIntentRegistry()),
    field = randomUUID();
  let scope: SpatialScope = {
    worldId: world.id,
    areaId: root.id,
    spaceId: world.id,
    footprint: root.footprint,
    crsId: world.reference.id,
    revision: 1,
    time: "present",
    resolution: null,
  };
  await service.commit(
    world.id,
    "alice",
    edit(scope, "putLayer", {
      id: "terrain",
      name: "Terrain",
      family: "physical",
      representation: "field",
      color: "#776655",
      profiles: ["world", "local"],
      schema: {},
      generator: null,
    })
  );
  scope = { ...scope, revision: 2 };
  await service.commit(
    world.id,
    "alice",
    edit(scope, "createField", {
      id: field,
      areaId: root.id,
      layerId: "terrain",
      footprint: root.footprint,
      width: 11,
      height: 11,
      channels: { elevation: { unit: "metre", values: 100 } },
    })
  );
  scope = { ...scope, revision: 3 };
  return { world, root, child, service, field, scope };
}
it("retains base samples, publishes local authored patches and restores them through undo", async () => {
  const db = await testDatabase();
  try {
    const database = new Database(db.client),
      fixture = await seedField(database);
    const { world, service, field } = fixture;
    let { scope } = fixture;
    const sculpt = edit(scope, "sculptField", {
      fieldId: field,
      center: { x: 50, y: 50, z: 0 },
      radius: 20,
      channel: "elevation",
      mode: "add",
      amount: 10,
    });
    const committed = await service.commit(world.id, "alice", sculpt);
    scope = { ...scope, revision: 4 };
    const projection = new ProjectionRepository(database),
      after = await projection.read(world.id, "alice", reads(scope, field));
    expect(sample(after.numerical[field], "elevation", { x: 50, y: 50, z: 0 })).toBe(110);
    expect(sample(after.numerical[field], "elevation", { x: 0, y: 0, z: 0 })).toBe(100);
    expect(after.fieldPatches).toHaveLength(1);
    await new UndoRepository(database).undo(
      world.id,
      "alice",
      randomUUID(),
      committed.operationId,
      reads(scope, field)
    );
    scope = { ...scope, revision: 5 };
    const restored = await projection.read(world.id, "alice", reads(scope, field));
    expect(sample(restored.numerical[field], "elevation", { x: 50, y: 50, z: 0 })).toBe(100);
    expect(restored.fieldPatches).toEqual([]);
    expect(after.world.fields[0].resourceId).toBe(restored.world.fields[0].resourceId);
  } finally {
    await db.close();
  }
});
it("keeps patch precedence when protection changes and samples exact patch footprints across read windows", async () => {
  const db = await testDatabase();
  try {
    const database = new Database(db.client),
      { world, service, field, scope } = await seedField(database),
      projection = new ProjectionRepository(database);
    const brush = {
      fieldId: field,
      center: { x: 50, y: 50, z: 0 },
      radius: 1,
      channel: "elevation",
      mode: "add",
      amount: 10,
      falloff: "constant",
    };
    await service.commit(world.id, "alice", edit(scope, "sculptField", brush));
    const afterA = await projection.read(
      world.id,
      "alice",
      reads({ ...scope, revision: 4 }, field)
    );
    await service.commit(
      world.id,
      "alice",
      edit({ ...scope, revision: 4 }, "sculptField", { ...brush, amount: 5 })
    );
    await service.commit(
      world.id,
      "alice",
      edit({ ...scope, revision: 5 }, "protectFieldPatch", {
        id: afterA.fieldPatches[0].id,
        protected: true,
      })
    );
    const current = { ...scope, revision: 6 },
      full = await projection.read(world.id, "alice", reads(current, field));
    expect(sample(full.numerical[field], "elevation", { x: 50, y: 50, z: 0 })).toBe(115);
    const outside = { x: 51.1, y: 50, z: 0 };
    const narrow = await projection.read(
      world.id,
      "alice",
      reads({ ...current, footprint: rectangle([51.05, 49.95, 51.15, 50.05]) }, field)
    );
    expect(sample(full.numerical[field], "elevation", outside)).toBe(100);
    expect(sample(narrow.numerical[field], "elevation", outside)).toBe(100);
    const smooth = edit(current, "sculptField", { ...brush, mode: "smooth", amount: 1 });
    const preview = await service.preview(world.id, "alice", smooth);
    expect(sample(preview.fields[field], "elevation", { x: 50, y: 50, z: 0 })).toBeCloseTo(
      100 + 15 / 9
    );
  } finally {
    await db.close();
  }
});
it("rejects an ancestor-field brush whose declared child context does not cover it", async () => {
  const db = await testDatabase();
  try {
    const database = new Database(db.client),
      { world, child, service, field, scope } = await seedField(database);
    const intent = edit(
      { ...scope, areaId: child.id, footprint: rectangle([0, 0, 10, 10]) },
      "sculptField",
      {
        fieldId: field,
        center: { x: 5, y: 5, z: 0 },
        radius: 2,
        channel: "elevation",
        mode: "add",
        amount: 100,
      }
    );
    await expect(service.commit(world.id, "alice", intent)).rejects.toMatchObject({
      code: "scope_extent",
    });
  } finally {
    await db.close();
  }
});
