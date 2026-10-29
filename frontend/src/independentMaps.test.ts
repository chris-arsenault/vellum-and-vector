import { expect, it, vi } from "vitest";
import { rectangle, sample, type DomainSnapshot } from "@atlas/domain";
import {
  readScene,
  readMapRasters,
  commitFixtureRecords,
  fixtureWorkspace,
} from "./testSupport/workspaceFixture";
import { landscape } from "../../packages/generation/src/mapFixtures";
import { putGenerated, putGeneratedDetail } from "../../packages/generation/src/mapFeatures";
import { generationSource } from "./workspaceGeneration";
import { WorkspaceFields } from "./workspaceFields";
import { SpatialCatalog, GeometryKernel } from "@atlas/storage-browser";
import { reopenSqliteFixture } from "../../packages/storage-browser/src/sqliteFixture";
import { publishWorkspaceGeneration } from "./generationPublication";
import { snapshotCopy } from "./testSupport/snapshotCopy";
import { independentMapFixture as fixture } from "./testSupport/independentMapFixture";

it("captures local feature and field ownership rather than resolving live parent geography", async () => {
  const f = await fixture(),
    before = await readScene(f.id, f.child);
  expect(before).toHaveLength(1);
  expect(before[0].areaId).toBe(f.child);
  expect(before[0].id).not.toBe(f.source.id);
  expect((await readMapRasters(f.id, f.child)).every((r) => r.areaId === f.child)).toBe(true);
  const workspace = await fixtureWorkspace(f.id),
    select = workspace.db.selectObjects.bind(workspace.db),
    denied = vi.spyOn(workspace.db, "selectObjects").mockImplementation((...args) => {
      const rows = select(...args);
      expect(rows.some((row) => row.kind === "feature" && row.area_id === f.root)).toBe(false);
      return rows;
    });
  try {
    const source = await generationSource(workspace.catalog, f.id, f.child);
    await workspace.catalog.readAuthoring({
      ...numericalReads(source),
      channels: [],
      objects: [{ kind: "feature", ids: [before[0].id] }],
    });
    await expect(
      workspace.catalog.readFeature(
        { worldId: f.id, areaId: f.child, spaceId: f.current().scope.spaceId },
        f.source.id
      )
    ).rejects.toMatchObject({ code: "missing_feature" });
  } finally {
    denied.mockRestore();
  }
  await commitFixtureRecords(f.id, [
    {
      kind: "feature",
      value: {
        ...f.source,
        name: "Parent changed",
        geometry: rectangle([80_000, 80_000, 90_000, 90_000]),
      },
    },
  ]);
  expect(await readScene(f.id, f.child)).toEqual(before);
});

it("publishes matching regional geography into the child without altering the parent feature", async () => {
  const f = await fixture(true),
    state = landscape();
  state.domain = f.current();
  state.domain.scope = {
    ...state.domain.scope,
    areaId: f.child,
    footprint: state.domain.world.areas[f.child].footprint,
  };
  const parent = structuredClone(state.domain.world.features[f.source.id]),
    generated = {
      ...f.source,
      id: crypto.randomUUID(),
      areaId: f.child,
      state: "generated" as const,
      protected: false,
      geometry: rectangle([30_000, 30_000, 60_000, 60_000]),
    };
  if (!putGeneratedDetail(state, generated, (candidate) => candidate.kind === "forest"))
    putGenerated(state, generated);
  expect(state.domain.world.features[f.source.id]).toEqual(parent);
  expect(
    Object.values(state.domain.world.features).some(
      (feature) =>
        feature.areaId === f.child &&
        JSON.stringify(feature.geometry) === JSON.stringify(generated.geometry)
    )
  ).toBe(true);
});

async function replaceParentField(
  workspace: Awaited<ReturnType<typeof fixtureWorkspace>>,
  original: DomainSnapshot,
  fieldId: string
) {
  const output = snapshotCopy(original),
    field = output.world.fields.find((candidate) => candidate.id === fieldId)!;
  field.resourceId = crypto.randomUUID();
  output.numerical[fieldId].id = field.resourceId;
  output.numerical[fieldId].channels.elevation.fill(700);
  output.world.version++;
  await publishWorkspaceGeneration(
    workspace.catalog,
    workspace.resources,
    original,
    output,
    crypto.randomUUID(),
    false,
    [],
    () => {}
  );
  return field.resourceId;
}
it("keeps frozen numerical inputs when parent resources are replaced and after catalog save/reopen", async () => {
  const f = await fixture(),
    workspace = await fixtureWorkspace(f.id),
    childField = f.current().world.fields.find((field) => field.areaId === f.child)!,
    rootField = f.current().world.fields.find((field) => field.areaId === f.root)!,
    position = { x: 40_000, y: 40_000, z: 0 },
    childResource = childField.resourceId;
  await f.command("sculptField", {
    fieldId: rootField.id,
    channel: "elevation",
    center: position,
    radius: 50_000,
    amount: 500,
    mode: "add",
    falloff: "constant",
  });
  expect(sample(f.current().numerical[rootField.id], "elevation", position)).toBeGreaterThan(100);
  expect(f.current().world.fields.find((field) => field.id === childField.id)!.resourceId).toBe(
    childResource
  );
  expect(sample(f.current().numerical[childField.id], "elevation", position)).toBe(100);
  const originalParentResource = rootField.resourceId;
  const replacement = await replaceParentField(workspace, f.current(), rootField.id);
  expect(replacement).not.toBe(originalParentResource);
  expect(
    (await workspace.catalog.readEditor(f.id)).fields.find((field) => field.id === rootField.id)!
      .resourceId
  ).toBe(replacement);
  const path = `/independent_${crypto.randomUUID()}.sqlite3`;
  workspace.catalog.snapshot(path);
  const reopened = new SpatialCatalog(
    reopenSqliteFixture(workspace.db, path),
    await GeometryKernel.create()
  );
  const reader = new WorkspaceFields(reopened, workspace.resources, workspace.working.cache);
  try {
    const source = await generationSource(reopened, f.id, f.child);
    expect(source.world.fields.every((field) => field.areaId === f.child)).toBe(true);
    await reader.read(source, numericalReads(source));
    expect(sample(source.numerical[childField.id], "elevation", position)).toBe(100);
    expect(
      reopened
        .exportFeatures(f.id, f.child, null, 128)
        .features.every((feature) => feature.properties.areaId === f.child)
    ).toBe(true);
  } finally {
    await reader.close();
    await reopened.close();
  }
});

function numericalReads(source: DomainSnapshot) {
  return {
    scope: source.scope,
    objects: [],
    channels: source.world.fields.map((field) => ({
      fieldId: field.id,
      names: field.channels ?? [],
    })),
    spatialLayers: [],
    parentHistory: [],
    dependencies: false,
  };
}
