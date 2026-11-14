import { expect, it } from "vitest";
import { rectangle, type AtlasFeature, type Area } from "@atlas/domain";
import { catalogChanges } from "@atlas/application";
import { GeometryKernel, SpatialCatalog, retainCompletedInputs } from "@atlas/storage-browser";
import { reopenSqliteFixture } from "../../packages/storage-browser/src/sqliteFixture";
import { publishedMapFixture } from "./testSupport/publishedMapFixture";
import {
  registerWorldSnapshot,
  fixtureWorkspace,
  commitFixtureRecords,
} from "./testSupport/workspaceFixture";
import { captureSelectedMap } from "@atlas/application";
import { generationSource } from "@atlas/application";

async function fixture() {
  const { snapshot } = publishedMapFixture();
  const island: AtlasFeature = {
    id: "island",
    areaId: snapshot.scope.areaId,
    layerId: "geology",
    name: "Original island",
    kind: "island",
    geometry: rectangle([30, 30, 70, 70]),
    detail: {},
    attributes: {},
    relations: [],
    causes: [],
    state: "generated",
    protected: false,
    actor: "generator",
    generationId: "supplied",
  };
  snapshot.world.features[island.id] = island;
  registerWorldSnapshot(snapshot);
  const workspace = await fixtureWorkspace(snapshot.world.id);
  const capture = async (revision: string) => {
    const world = await workspace.catalog.readWorld(snapshot.world.id);
    return retainCompletedInputs(
      workspace.catalog.generationInputs,
      async () => {
        const path = `/retained_${crypto.randomUUID()}.sqlite3`;
        workspace.catalog.snapshot(path);
        return { name: "fixture", path };
      },
      {
        reference: { mapId: snapshot.scope.areaId, revision },
        worldId: world.id,
        areaId: snapshot.scope.areaId,
        revision: world.version,
      }
    );
  };
  return { snapshot, workspace, capture, island };
}

it("captures the selected old map's features and resources after the parent has changed", async () => {
  const { workspace, capture, island } = await fixture();
  const input = await capture("selected");
  await commitFixtureRecords(input.worldId, [
    {
      kind: "feature",
      value: {
        ...island,
        name: "Changed island",
        geometry: rectangle([80, 80, 90, 90]),
      },
    },
  ]);
  const source = await generationSource(workspace.catalog, input.worldId, input.areaId);
  const area: Area = {
    ...source.world.areas[input.areaId],
    id: "child",
    parentId: input.areaId,
    footprint: rectangle([25, 25, 75, 75]),
    map: { sourceAreaId: input.areaId, sourceRevision: source.world.version, refinementLevel: 1 },
  };
  const publication = catalogChanges(
    source,
    {
      operationId: crypto.randomUUID(),
      worldId: input.worldId,
      expectedVersion: source.world.version,
      actor: "user",
      writes: [{ kind: "area", value: area }],
      removes: [],
      readSet: [],
      invalidations: [],
      highImpact: false,
    },
    [],
    "createArea"
  );
  await captureSelectedMap(
    async (reference, read) => {
      const retained = workspace.catalog.generationInputs.read(reference);
      const catalog = new SpatialCatalog(
        reopenSqliteFixture(workspace.db, retained.root.path),
        await GeometryKernel.create()
      );
      try {
        await read(catalog, retained);
      } finally {
        await catalog.close();
      }
    },
    workspace.resources,
    input.reference,
    area,
    publication
  );
  await workspace.catalog.commit(publication);
  const child = await generationSource(workspace.catalog, input.worldId, area.id);
  expect(child.world.areas[area.id].map?.sourceMap).toEqual(input.reference);
  const captured = publication.writes.find((write) => write.data.kind === "feature");
  expect(captured?.data.value).toMatchObject({ name: "Original island", areaId: area.id });
  expect(child.world.fields.every((field) => field.areaId === area.id)).toBe(true);
  expect(child.world.fields.length).toBeGreaterThan(0);
  const resource = await workspace.resources.describe(child.world.fields[0].resourceId!);
  const original = await workspace.resources.describe(source.world.fields[0].resourceId!);
  expect(resource.arrays.map((array) => array.source)).toEqual(
    original.arrays.map((array) => array.source ?? { resourceId: original.id, array: array.name })
  );
  expect((await workspace.catalog.readFeature(source.scope, island.id)).name).toBe(
    "Changed island"
  );
});

it("pins completed inputs across parent updates and catalog save/reopen", async () => {
  const { snapshot, workspace, capture } = await fixture();
  const first = await capture("first");
  const area = snapshot.world.areas[snapshot.scope.areaId];
  await commitFixtureRecords(snapshot.world.id, [
    { kind: "area", value: { ...area, name: "Changed parent" } },
  ]);
  const second = await capture("second");
  expect(second.revision).toBeGreaterThan(first.revision);
  const saved = `/saved_${crypto.randomUUID()}.sqlite3`;
  workspace.catalog.snapshot(saved);
  const reopened = new SpatialCatalog(
    reopenSqliteFixture(workspace.db, saved),
    await GeometryKernel.create()
  );
  try {
    const retained = reopened.generationInputs.read(first.reference);
    expect(retained).toEqual(first);
    const original = new SpatialCatalog(
      reopenSqliteFixture(workspace.db, retained.root.path),
      await GeometryKernel.create()
    );
    try {
      expect((await original.readEditor(first.worldId)).areas[first.areaId].name).toBe(area.name);
      expect((await reopened.readEditor(first.worldId)).areas[first.areaId].name).toBe(
        "Changed parent"
      );
    } finally {
      await original.close();
    }
    expect(reopened.generationInputs.read(second.reference)).toEqual(second);
    expect(() =>
      reopened.generationInputs.bind({ ...second, reference: first.reference })
    ).toThrow();
    expect(reopened.generationInputs.read(first.reference)).toEqual(first);
  } finally {
    await reopened.close();
  }
});

it("rejects stale, missing and incomplete generation inputs", async () => {
  const { workspace, capture } = await fixture();
  const input = await capture("first");
  const store = workspace.catalog.generationInputs;
  expect(() => store.read({ ...input.reference, revision: "absent" })).toThrow(
    "no completed inputs"
  );
  expect(() => store.bind({ ...input, revision: input.revision - 1 })).toThrow("geography changed");
  expect(() => store.bind({ ...input, areaId: "absent" })).toThrow("existing mapped area");
  const world = await workspace.catalog.readWorld(input.worldId);
  workspace.db.exec({
    sql: "UPDATE worlds SET data=? WHERE id=?",
    bind: [JSON.stringify({ ...world, publication: { state: "incomplete" } }), world.id],
  });
  expect(() => store.bind(input)).toThrow("Complete the geography");
});
