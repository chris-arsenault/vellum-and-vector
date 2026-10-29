import { expect, it } from "vitest";
import {
  rectangle,
  spatial,
  sample,
  createGrid,
  putChannel,
  generateChannel,
  regionRefinementInput,
  refinedRegionArea,
} from "@atlas/domain";
import { authoredFields } from "../../packages/generation/src/mapAuthored";
import {
  regionalInputChannels,
  regionalInputFields,
} from "../../packages/generation/src/regionalInputs";
import { catalogChanges } from "@atlas/application";
import { independentMapFixture } from "./testSupport/independentMapFixture";
import { fixtureWorkspace, commitFixtureRecords } from "./testSupport/workspaceFixture";
import { captureExistingMaps } from "./mapConversion";
import { generationSource } from "./workspaceGeneration";
import { WorkspaceFields } from "./workspaceFields";

it("detaches an old saved region while retaining its existing finer geometry", async () => {
  const f = await independentMapFixture(),
    workspace = await fixtureWorkspace(f.id),
    source = f.current(),
    legacy = { ...source.world.areas[f.child], map: undefined },
    detailed = {
      ...f.source,
      detail: {
        [f.child]: {
          geometry: rectangle([30_000, 30_000, 60_000, 60_000]),
          state: "generated" as const,
          attributes: {},
          protected: false,
          needsReconciliation: false,
          generationId: null,
          actor: "generator",
        },
      },
    };
  await workspace.catalog.commit(
    catalogChanges(
      source,
      {
        operationId: crypto.randomUUID(),
        expectedVersion: source.world.version,
        worldId: f.id,
        actor: "user",
        readSet: source.revisions,
        writes: [
          { kind: "area", value: legacy },
          { kind: "feature", value: detailed },
        ],
        removes: [
          ...Object.values(source.world.features)
            .filter((feature) => feature.areaId === f.child)
            .map((feature) => ({ kind: "feature" as const, id: feature.id })),
          ...source.world.fields
            .filter((field) => field.areaId === f.child)
            .map((field) => ({ kind: "field" as const, id: field.id })),
        ],
        invalidations: [],
        highImpact: false,
      },
      [],
      "legacy fixture"
    )
  );
  const query = {
      scope: { worldId: f.id, areaId: f.child, spaceId: source.scope.spaceId },
      extent: [0, 0, 100_000, 100_000] as [number, number, number, number],
      layers: [],
      after: null,
      limit: 128,
      predicate: "intersects" as const,
      geometry: null,
    },
    before = (await workspace.catalog.readFeatures(query)).records;
  expect(spatial.canonical(before[0].feature.geometry)).toEqual(
    spatial.canonical(detailed.detail[f.child].geometry)
  );
  const converted = await captureExistingMaps(workspace, f.id);
  expect(converted.areas[f.child].map).toBeDefined();
  const after = (await workspace.catalog.readFeatures(query)).records;
  expect(after.map((r) => r.feature.geometry)).toEqual(before.map((r) => r.feature.geometry));
  expect(after.every((r) => r.feature.areaId === f.child)).toBe(true);
  expect((await captureExistingMaps(workspace, f.id)).version).toBe(converted.version);
});

it("retains a saved map's surface patches when capturing its generation inputs", async () => {
  const f = await independentMapFixture(),
    field = f.current().world.fields.find((candidate) => candidate.areaId === f.child)!,
    position = { x: 40_000, y: 40_000, z: 0 },
    snapshot = f.current(),
    patch = createGrid(
      crypto.randomUUID(),
      {
        ...snapshot.scope,
        areaId: f.child,
        footprint: rectangle([30_000, 30_000, 60_000, 60_000]),
      },
      3,
      3
    );
  putChannel(
    patch,
    "elevation",
    "metre",
    generateChannel(patch, "elevation", () => 350)
  );
  snapshot.numerical[patch.id] = patch;
  snapshot.fieldPatches.push({
    id: crypto.randomUUID(),
    fieldId: field.id,
    areaId: f.child,
    spaceId: snapshot.scope.spaceId,
    footprint: patch.scope.footprint,
    channels: ["elevation"],
    actor: "user",
    resourceId: patch.id,
    protected: true,
    createdVersion: snapshot.world.version,
  });
  await commitFixtureRecords(f.id, [
    { kind: "area", value: { ...f.current().world.areas[f.child], map: undefined } },
  ]);
  const workspace = await fixtureWorkspace(f.id);
  await captureExistingMaps(workspace, f.id);
  const source = await generationSource(workspace.catalog, f.id, f.child),
    fields = new WorkspaceFields(workspace.catalog, workspace.resources, workspace.working.cache);
  try {
    await fields.read(source, {
      scope: source.scope,
      objects: [],
      spatialLayers: [],
      parentHistory: [],
      dependencies: false,
      channels: source.world.fields.map((entry) => ({ fieldId: entry.id, names: ["elevation"] })),
    });
    const input = regionalInputChannels(regionalInputFields(source, f.child)).get("elevation")!;
    expect(sample(input, "elevation", position)).toBe(350);
    expect(source.fieldPatches.some((entry) => entry.fieldId !== field.id && entry.protected)).toBe(
      true
    );
  } finally {
    await fields.close();
  }
});

it("captures a source map's surface patch as starting context without freezing the child's heights", async () => {
  const f = await independentMapFixture(),
    snapshot = f.current(),
    field = snapshot.world.fields.find((entry) => entry.areaId === f.child)!,
    patch = createGrid(
      crypto.randomUUID(),
      {
        ...snapshot.scope,
        areaId: f.child,
        footprint: rectangle([30_000, 30_000, 60_000, 60_000]),
      },
      3,
      3
    );
  putChannel(
    patch,
    "elevation",
    "metre",
    generateChannel(patch, "elevation", () => 350)
  );
  snapshot.numerical[patch.id] = patch;
  snapshot.fieldPatches.push({
    id: crypto.randomUUID(),
    fieldId: field.id,
    areaId: f.child,
    spaceId: snapshot.scope.spaceId,
    footprint: patch.scope.footprint,
    channels: ["elevation"],
    actor: "user",
    resourceId: patch.id,
    protected: true,
    mapOnly: true,
    createdVersion: snapshot.world.version,
  });
  const regionId = crypto.randomUUID();
  await f.command("putView", {
    id: regionId,
    areaId: f.child,
    name: "Inner coast",
    layers: [],
    region: { parentId: null, footprint: rectangle([35_000, 35_000, 55_000, 55_000]) },
  });
  await f.command("createArea", regionRefinementInput(f.current().world, regionId));
  const child = refinedRegionArea(f.current().world, regionId)!,
    workspace = await fixtureWorkspace(f.id),
    source = await generationSource(workspace.catalog, f.id, child.id),
    fields = new WorkspaceFields(workspace.catalog, workspace.resources, workspace.working.cache);
  try {
    await fields.read(source, {
      scope: source.scope,
      objects: [],
      spatialLayers: [],
      parentHistory: [],
      dependencies: false,
      channels: source.world.fields.map((entry) => ({ fieldId: entry.id, names: ["elevation"] })),
    });
    const input = regionalInputChannels(regionalInputFields(source, child.id)).get("elevation")!;
    expect(sample(input, "elevation", { x: 40_000, y: 40_000, z: 0 })).toBe(350);
    expect(source.fieldPatches).toHaveLength(1);
    expect(source.fieldPatches[0]).toMatchObject({ input: true, protected: false });
    expect(source.fieldPatches[0].mapOnly).toBeUndefined();
    expect(authoredFields(source)).toEqual([]);
  } finally {
    await fields.close();
  }
});
