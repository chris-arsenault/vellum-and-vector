import { expect, it } from "vitest";
import {
  effectiveTraits,
  rectangle,
  regionRefinementInput,
  refinedRegionArea,
  type DrainageReach,
  type Area,
  type DomainWrite,
} from "@atlas/domain";
import { source as magicSource } from "../../packages/generation/src/mapFixtures";
import {
  fixtureWorld,
  fixtureState,
  commitCommand,
  commitFixtureRecords,
  fixtureWorkspace,
} from "./testSupport/workspaceFixture";
import { generationSource } from "./workspaceGeneration";

function reach(x: number, downstream: number | null): DrainageReach {
  return {
    coordinates: [
      [x, 25_000],
      [x, 50_000],
    ],
    downstream,
    waterBody: null,
    order: 1,
    basin: 0,
    discharges: [10, 10],
    catchmentAreas: [100, 100],
    featureIds: [],
  };
}
async function capturedContext() {
  const world = fixtureWorld({ name: "Context", seed: 1, width: 100_000, height: 100_000 }),
    root = Object.values(world.areas)[0],
    state = () => fixtureState(world.id).snapshot,
    command = (kind: string, data: Record<string, unknown>) =>
      commitCommand(world.id, {
        operationId: crypto.randomUUID(),
        expectedVersion: state().world.version,
        kind,
        data,
      }),
    regionId = crypto.randomUUID();
  await commitFixtureRecords(world.id, [
    {
      kind: "area",
      value: {
        ...root,
        localTraits: [
          {
            field: "elevation",
            kind: "hard",
            minimum: 100,
            maximum: 500,
            cause: null,
            scope: null,
          },
        ],
      },
    },
    {
      kind: "drainage",
      value: {
        id: `drainage:${root.id}`,
        areaId: root.id,
        spaceId: root.spaceId!,
        reaches: [reach(95_000, null), reach(30_000, 2), reach(40_000, null)],
      },
    },
    ...contextSources(root),
  ]);
  await command("putView", {
    id: regionId,
    areaId: root.id,
    name: "Local coast",
    layers: [],
    region: { parentId: null, footprint: rectangle([10_000, 10_000, 80_000, 80_000]) },
  });
  await command("createArea", regionRefinementInput(state().world, regionId));
  const child = refinedRegionArea(state().world, regionId)!,
    workspace = await fixtureWorkspace(world.id);
  return { child, root, world, state, workspace };
}
function contextSources(root: Area): DomainWrite[] {
  const landmark = crypto.randomUUID(),
    first = crypto.randomUUID(),
    second = crypto.randomUUID();
  return [
    {
      kind: "landmark" as const,
      value: {
        id: landmark,
        name: "Captured spring",
        kind: "fire-wellspring",
        geometry: { type: "Point", coordinates: [30_000, 30_000] },
        parameters: { intensity: 500, reach: 10 },
        emplacedAtEpoch: 0,
        areaId: root.id,
        spaceId: root.spaceId!,
      },
    },
    {
      kind: "magic" as const,
      value: magicSource({
        id: first,
        landmarkId: landmark,
        areaId: root.id,
        spaceId: root.spaceId!,
        source: { x: 30_000, y: 30_000, z: 0 },
      }),
    },
    {
      kind: "magic" as const,
      value: magicSource({
        id: second,
        dependsOn: [first],
        areaId: root.id,
        spaceId: root.spaceId!,
        source: { x: 30_000, y: 30_000, z: 0 },
      }),
    },
  ];
}

it("keeps trait controls local instead of consulting parent envelopes", async () => {
  const f = await capturedContext();
  expect(effectiveTraits(f.state().world.areas, f.child.id)).toEqual([]);
  await commitFixtureRecords(f.world.id, [{ kind: "area", value: { ...f.root, localTraits: [] } }]);
  expect(effectiveTraits(f.state().world.areas, f.child.id)).toEqual([]);
});

it("captures valid local drainage indexes and links magic to the captured landmark and source", async () => {
  const f = await capturedContext(),
    source = await generationSource(f.workspace.catalog, f.world.id, f.child.id),
    drainage = source.world.drainage![f.child.id],
    landmark = source.world.landmarks[0],
    injected = source.world.magic.find((s) => s.landmarkId)!,
    dependent = source.world.magic.find((s) => s.dependsOn?.length)!;
  expect(drainage.reaches).toHaveLength(2);
  expect(drainage.reaches[0].downstream).toBe(1);
  expect(injected.landmarkId).toBe(landmark.id);
  expect(dependent.dependsOn).toEqual([injected.id]);
});
