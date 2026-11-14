import { expect, it } from "vitest";
import { rectangle, type CatalogRecord, type CatalogChanges } from "@atlas/domain";
import { fixture, scope, record, write, query } from "./catalogFixture";

function batch(operationId: string, records: CatalogRecord[]): CatalogChanges {
  return {
    operationId,
    worldId: scope.worldId,
    expected: records.map((r) => r.reference),
    writes: records,
    removes: [],
    resources: [],
    history: { kind: "generate", actor: "generator" },
  };
}
it("keeps staged records invisible, publishes one revision, and undoes more than one history page", async () => {
  const catalog = await fixture();
  const token = await catalog.beginPublication({
    worldId: scope.worldId,
    operationId: "generation",
    expectedWorldRevision: 1,
    history: { kind: "generate", actor: "generator" },
  });
  for (let page = 0; page < 5; page++) {
    const records = Array.from({ length: 100 }, (_, i) => record(`feature-${page * 100 + i}`));
    await catalog.appendPublication(token, batch("generation", records));
  }
  expect((await catalog.readFeatures(query())).records).toHaveLength(0);
  expect((await catalog.readWorld(scope.worldId)).version).toBe(1);
  const change = await catalog.finishPublication(token);
  expect(change).toMatchObject({ revision: 2, records: [], recordKinds: ["feature"] });
  expect(change.extents).toHaveLength(1);
  expect((await catalog.readWorld(scope.worldId)).featureCount).toBe(500);
  expect(await catalog.readHistory(scope.worldId, null, 10)).toMatchObject([
    { operationId: "generation", kind: "generate", actor: "generator", version: 2 },
  ]);
  const undone = await catalog.undo(scope.worldId, "generation");
  expect(undone.recordKinds).toEqual(["feature"]);
  expect(undone.extents).toHaveLength(1);
  expect((await catalog.readWorld(scope.worldId)).featureCount).toBe(0);
  expect(await catalog.readHistory(scope.worldId, null, 10)).toEqual([]);
});
it("rolls back every staged batch if the final geometry is invalid", async () => {
  const catalog = await fixture();
  const token = await catalog.beginPublication({
    worldId: scope.worldId,
    operationId: "generation",
    expectedWorldRevision: 1,
  });
  await catalog.appendPublication(token, batch("generation", [record("first")]));
  const invalid = record("invalid", {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [10, 10],
        [10, 0],
        [0, 10],
        [0, 0],
      ],
    ],
  });
  await catalog.appendPublication(token, batch("generation", [invalid]));
  await expect(catalog.finishPublication(token)).rejects.toThrow(/valid/);
  expect((await catalog.readFeatures(query())).records).toEqual([]);
  expect((await catalog.readWorld(scope.worldId)).version).toBe(1);
  expect(await catalog.readHistory(scope.worldId, null, 10)).toEqual([]);
  await expect(catalog.finishPublication(token)).rejects.toThrow(/no longer active/);
});
it("allows edits while preparing and preserves them when regeneration conflicts", async () => {
  const catalog = await fixture();
  const token = await catalog.beginPublication({
    worldId: scope.worldId,
    operationId: "generation",
    expectedWorldRevision: 1,
  });
  await catalog.appendPublication(token, batch("generation", [record("generated")]));
  await write(catalog, [record("authored", rectangle([200, 200, 300, 300]))]);
  await expect(catalog.finishPublication(token)).rejects.toThrow(/world changed/);
  expect((await catalog.readFeatures(query())).records.map((r) => r.feature.id)).toEqual([
    "authored",
  ]);
  expect((await catalog.readWorld(scope.worldId)).version).toBe(2);
});
it("discards cancellation scratch without changing geography or history", async () => {
  const catalog = await fixture();
  const token = await catalog.beginPublication({
    worldId: scope.worldId,
    operationId: "generation",
    expectedWorldRevision: 1,
  });
  await catalog.appendPublication(token, batch("generation", [record("abandoned")]));
  await catalog.discardPublication(token);
  await expect(catalog.finishPublication(token)).rejects.toThrow(/no longer active/);
  expect((await catalog.readFeatures(query())).records).toEqual([]);
  expect(await catalog.readHistory(scope.worldId, null, 10)).toEqual([]);
});
