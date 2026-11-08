import { expect, it } from "vitest";
import {
  rectangle,
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
import { independentMapFixture } from "./testSupport/independentMapFixture";
import { fixtureWorkspace } from "./testSupport/workspaceFixture";
import { generationSource } from "./workspaceGeneration";
import { WorkspaceFields } from "./workspaceFields";

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
