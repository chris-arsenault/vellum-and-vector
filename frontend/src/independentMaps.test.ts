import { expect, it, vi } from "vitest";
import {
  rectangle,
  regionRefinementInput,
  refinedRegionArea,
  sample,
  type DomainSnapshot,
} from "@atlas/domain";
import {
  fixtureState,
  commitCommand,
  readScene,
  readMapRasters,
  commitFixtureRecords,
  fixtureWorkspace,
  registerWorldSnapshot,
} from "./testSupport/workspaceFixture";
import { landscape } from "../../packages/generation/src/mapFixtures";
import { putGenerated, putGeneratedDetail } from "../../packages/generation/src/mapFeatures";
import { generationSource } from "./workspaceGeneration";
import { WorkspaceFields } from "./workspaceFields";
import { loadGenerationFeatures } from "./generationInputs";
import {
  SqliteFeatureWorkspace,
  SqliteNetworkWorkspace,
  SpatialCatalog,
  GeometryKernel,
} from "@atlas/storage-browser";
import {
  sqliteFixture,
  reopenSqliteFixture,
} from "../../packages/storage-browser/src/sqliteFixture";
import { prepareAtlasGeneration, generationSnapshot } from "@atlas/generation";
import { atlasInitialState } from "../../packages/generation/src/atlasInitialState";
import { MapRunner } from "../../packages/generation/src/mapRunner";
import { publishWorkspaceGeneration } from "./generationPublication";
import { constructedWorld } from "./constructedWorldFixture";
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

async function refinementFixture() {
  const constructed = constructedWorld(),
    parent = generationSnapshot(constructed.result, constructed.input, crypto.randomUUID());
  registerWorldSnapshot(parent);
  const id = parent.world.id,
    root = parent.scope.areaId,
    current = () => fixtureState(id).snapshot,
    command = (kind: string, data: Record<string, unknown>) =>
      commitCommand(id, {
        operationId: crypto.randomUUID(),
        expectedVersion: current().world.version,
        kind,
        data,
      }),
    regionId = crypto.randomUUID();
  await command("putView", {
    id: regionId,
    name: "Closer coast",
    areaId: root,
    layers: [],
    region: { parentId: null, footprint: rectangle([1000, 100, 3000, 900]) },
  });
  await command("createArea", regionRefinementInput(current().world, regionId));
  const child = refinedRegionArea(current().world, regionId)!.id,
    workspace = await fixtureWorkspace(id);
  return { id, root, child, workspace, current, parent };
}
function denyParentReads(
  workspace: Awaited<ReturnType<typeof fixtureWorkspace>>,
  child: string,
  parentFields: Set<string>
) {
  const originalRead = workspace.catalog.readAuthoring.bind(workspace.catalog);
  const deny = vi.spyOn(workspace.catalog, "readAuthoring").mockImplementation(async (request) => {
    expect(request.scope.areaId).toBe(child);
    expect(request.channels.some((field) => parentFields.has(field.fieldId))).toBe(false);
    const snapshot = await originalRead(request);
    expect(snapshot.world.fields.every((field) => field.areaId === child)).toBe(true);
    expect(
      Object.values(snapshot.world.features).every((feature) => feature.areaId === child)
    ).toBe(true);
    return snapshot;
  });
  return deny;
}
it("refines and publishes from captured inputs with parent geography reads denied", async () => {
  const { id, root, child, workspace, current, parent } = await refinementFixture(),
    before = workspace.catalog.exportFeatures(id, root, null, 128),
    parentFields = new Set(
      current()
        .world.fields.filter((field) => field.areaId === root)
        .map((field) => field.id)
    ),
    rootScope = { worldId: id, areaId: root, spaceId: parent.scope.spaceId },
    rootFields = await workspace.catalog.readRecords(rootScope, "field", [...parentFields]),
    deny = denyParentReads(workspace, child, parentFields),
    db = await sqliteFixture(),
    features = new SqliteFeatureWorkspace(db),
    sourceFeatures = new SqliteFeatureWorkspace(db, "source_features"),
    networks = new SqliteNetworkWorkspace(db),
    sourceNetworks = new SqliteNetworkWorkspace(db, "source_networks"),
    fields = new WorkspaceFields(workspace.catalog, workspace.resources, workspace.working.cache);
  try {
    const source = await generationSource(workspace.catalog, id, child);
    await loadGenerationFeatures(
      source,
      workspace.catalog,
      sourceFeatures,
      undefined,
      sourceNetworks
    );
    await fields.read(source, numericalReads(source));
    const prepared = prepareAtlasGeneration(
        source,
        { areaId: child, quality: "draft", seed: 73, domains: ["physical"] },
        sourceFeatures
      ),
      initial = atlasInitialState(prepared.source, prepared.input, workspace.working.cache);
    expect(prepared.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const result = await new MapRunner(prepared.input.configuration!, prepared.registry).run(
      initial,
      {
        seed: "73",
        seedScope: child,
        cache: workspace.working.cache,
        features,
        sourceFeatures,
        networks,
        sourceNetworks,
      }
    );
    const operationId = crypto.randomUUID(),
      output = generationSnapshot(result, prepared.input, operationId, source);
    await publishWorkspaceGeneration(
      workspace.catalog,
      workspace.resources,
      source,
      output,
      operationId,
      false,
      [],
      () => {},
      undefined,
      { features, sourceFeatures, networks, sourceNetworks }
    );
    expect(workspace.catalog.exportFeatures(id, root, null, 128)).toEqual(before);
    expect(await workspace.catalog.readRecords(rootScope, "field", [...parentFields])).toEqual(
      rootFields
    );
    expect(output.world.fields.some((field) => field.areaId === child && !field.input)).toBe(true);
    expect(output.world.epochs).toEqual(parent.world.epochs);
  } finally {
    deny.mockRestore();
    await fields.close();
    db.close();
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
