import { expect, it } from "vitest";
import {
  effectiveTraits,
  rectangle,
  regionRefinementInput,
  refinedRegionArea,
  type DrainageReach,
  type RetainedRiver,
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
function heldRiver(): RetainedRiver {
  return {
    id: 11,
    river: "long-river",
    name: "Long River",
    course: reach(99_000, null).coordinates,
    downstream: null,
    order: 2,
    flow: 0,
    least: 0,
    flood: 0,
    months: 0,
    dry: true,
    drawn: true,
    former: [{ course: reach(30_000, null).coordinates, leftIn: 1 }],
    monthly: Array(24).fill(0),
    catchment: [100, 100],
    bed: [90, 80],
    width: [5, 6],
    depth: [1, 1],
    leakage: [0.1, 0.1],
  };
}
async function capturedContext(kept = [heldRiver()]) {
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
        reaches: [
          reach(99_000, null),
          reach(30_000, 2),
          reach(40_000, null),
          {
            ...reach(30_000, null),
            coordinates: [[30_000, 30_000]],
            discharges: [20],
            catchmentAreas: [100_000],
          },
        ],
        kept: {
          next: Math.max(...kept.map((reach) => reach.id)) + 1,
          entries: [
            {
              position: [0, 25_000],
              monthly: Array.from({ length: 12 }, (_, month) => (month < 6 ? 40 : 0)),
              catchment: 9000,
            },
            { position: [99_000, 25_000], monthly: Array(12).fill(999), catchment: 999 },
          ],
          reaches: kept,
        },
      },
    },
    ...contextSources(root),
  ]);
  await command("putView", {
    id: regionId,
    areaId: root.id,
    name: "Local coast",
    layers: [],
    region: { parentId: null, footprint: rectangle([0, 10_000, 80_000, 80_000]) },
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
  expect(drainage.reaches).toHaveLength(3);
  expect(drainage.reaches[0].downstream).toBe(1);
  expect(drainage.reaches[2].coordinates).toEqual([[30_000, 30_000]]);
  expect(drainage.input).toBe(true);
  expect(drainage.kept?.reaches[0]).toMatchObject({
    river: "long-river",
    name: "Long River",
    dry: true,
    bed: [90, 80],
    former: [{ course: reach(30_000, null).coordinates, leftIn: 1 }],
  });
  expect(drainage.kept?.entries).toEqual([
    {
      position: [0, 25_000],
      monthly: Array.from({ length: 12 }, (_, month) => (month < 6 ? 40 : 0)),
      catchment: 9000,
    },
  ]);
  expect(injected.landmarkId).toBe(landmark.id);
  expect(dependent.dependsOn).toEqual([injected.id]);
});

it("captures a one-cell course crossing into the child through its verified receiving junction", async () => {
  const receiving = {
      ...heldRiver(),
      course: [
        [1000, 50_000],
        [1000, 60_000],
      ] as [number, number][],
      former: [],
    },
    crossing: RetainedRiver = {
      ...heldRiver(),
      id: 12,
      river: "seat-stream",
      name: "Seat Stream",
      course: [[-1000, 50_000]],
      junction: [1000, 50_000],
      downstream: receiving.id,
      former: [],
      monthly: Array(12).fill(0),
      catchment: [100],
      bed: [90],
      width: [5],
      depth: [1],
      leakage: [0.1],
    },
    f = await capturedContext([crossing, receiving]),
    source = await generationSource(f.workspace.catalog, f.world.id, f.child.id),
    captured = source.world.drainage![f.child.id].kept!.reaches.find(
      (reach) => reach.id === crossing.id
    )!;
  expect(captured).toMatchObject({
    river: "seat-stream",
    name: "Seat Stream",
    course: crossing.course,
    junction: crossing.junction,
    downstream: receiving.id,
  });
  expect(captured.monthly).toHaveLength(12);
  expect(captured.catchment).toEqual([100]);
});
