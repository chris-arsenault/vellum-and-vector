import {
  rectangle,
  regionRefinementInput,
  refinedRegionArea,
  type AtlasFeature,
} from "@atlas/domain";
import {
  fixtureWorld,
  fixtureState,
  commitCommand,
  commitFixtureRecords,
} from "./workspaceFixture";

export async function independentMapFixture(protectedSource = false) {
  const initial = fixtureWorld({
      name: "Independent maps",
      seed: 17,
      width: 100_000,
      height: 100_000,
    }),
    root = Object.values(initial.areas)[0].id;
  const current = () => fixtureState(initial.id).snapshot;
  const command = (kind: string, data: Record<string, unknown>) =>
    commitCommand(initial.id, {
      operationId: crypto.randomUUID(),
      expectedVersion: current().world.version,
      kind,
      data,
    });
  await command("createField", { areaId: root, layerId: "elevation", resolution: 9, value: 100 });
  const source: AtlasFeature = {
    id: crypto.randomUUID(),
    areaId: root,
    name: "Island woods",
    kind: "forest",
    layerId: "ecology",
    geometry: rectangle([20_000, 20_000, 70_000, 70_000]),
    detail: {},
    attributes: {},
    relations: [],
    state: protectedSource ? "authored" : "generated",
    protected: protectedSource,
    generationId: null,
    actor: protectedSource ? "user" : "generator",
    causes: [],
  };
  const outside = {
    ...source,
    id: crypto.randomUUID(),
    geometry: rectangle([90_000, 90_000, 95_000, 95_000]),
  };
  source.relations = [{ kind: "dependsOn", targetId: outside.id }];
  await commitFixtureRecords(initial.id, [
    { kind: "feature", value: source },
    { kind: "feature", value: outside },
  ]);
  const regionId = crypto.randomUUID();
  await command("putView", {
    id: regionId,
    areaId: root,
    name: "Island",
    layers: [],
    region: { parentId: null, footprint: rectangle([10_000, 10_000, 80_000, 80_000]) },
  });
  await command("createArea", regionRefinementInput(current().world, regionId));
  const child = refinedRegionArea(current().world, regionId)!.id;
  return { id: initial.id, root, child, source, current, command };
}
