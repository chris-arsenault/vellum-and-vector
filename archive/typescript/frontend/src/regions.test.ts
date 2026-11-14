import {
  fixtureWorld,
  fixtureState,
  undoWorld,
  commitCommand,
  exportWorld,
  readScene,
} from "./testSupport/workspaceFixture";
import { describe, expect, it } from "vitest";
import {
  availableRegionFootprint,
  regionLineage,
  rectangle,
  spatial,
  snapRegionCut,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import { numericalValues } from "./testSupport/snapshotCopy";

function fixture() {
  const world = fixtureWorld({
    name: "Source atlas",
    seed: 13,
    width: 10_000_000,
    height: 10_000_000,
  });
  const areaId = Object.keys(world.areas)[0];
  const put = async (data: Record<string, unknown>, kind = "putView") =>
    await commitCommand(world.id, {
      operationId: crypto.randomUUID(),
      expectedVersion: fixtureState(world.id).snapshot.world.version,
      kind,
      data,
    });
  const region = async (name: string, footprint: Geometry, parentId: string | null = null) => {
    const id = crypto.randomUUID();
    await put({ id, name, areaId, layers: [], region: { parentId, footprint } });
    return id;
  };
  return { world, areaId, put, region };
}
async function existingGeography(f: ReturnType<typeof fixture>) {
  await f.put({ areaId: f.areaId, layerId: "elevation", resolution: 9, value: 7 }, "createField");
  await f.put(
    {
      areaId: f.areaId,
      feature: {
        id: crypto.randomUUID(),
        name: "Existing place",
        kind: "poi",
        layerId: "pois",
        geometry: { type: "Point", coordinates: [1000, 1000] },
        attributes: {},
        relations: [],
        protected: true,
      },
    },
    "putFeature"
  );
}

it("supports arbitrary named and unnamed-depth regions without changing geography or detail eligibility", async () => {
  const f = fixture();
  await existingGeography(f);
  const before = fixtureState(f.world.id).snapshot;
  const scene = await readScene(f.world.id, f.areaId);
  let parent: string | null = null;
  for (let i = 1; i <= 12; i++) {
    const span = 10_000_000 / 2 ** i;
    parent = await f.region(
      i % 2 ? "The reach" : `Area ${i}`,
      rectangle([0, 0, span, span]),
      parent
    );
  }
  const after = fixtureState(f.world.id).snapshot;
  expect(regionLineage(after.world, parent)).toHaveLength(12);
  expect(after.world.areas).toEqual(before.world.areas);
  expect(after.world.features).toEqual(before.world.features);
  expect(after.world.fields).toEqual(before.world.fields);
  expect(numericalValues(after)).toEqual(numericalValues(before));
  expect(after.world.generations).toEqual([]);
  expect(await readScene(f.world.id, f.areaId)).toEqual(scene);
  expect((await exportWorld(f.world.id)).regions).toHaveLength(12);
  await undoWorld(f.world.id, fixtureState(f.world.id).history[0].operationId);
  expect(fixtureState(f.world.id).snapshot.world.views).toHaveLength(11);
});
it("validates smaller contained regions, useful width, cycles and source-map identity", async () => {
  const f = fixture(),
    id = await f.region("First", rectangle([0, 0, 4000, 4000]));
  const view = fixtureState(f.world.id).snapshot.world.views[0];
  await expect(
    async () => await f.region("Too thin", rectangle([0, 0, 10, 4000]), id)
  ).rejects.toThrow(/width/);
  await expect(
    async () => await f.region("Outside", rectangle([0, 0, 5000, 5000]), id)
  ).rejects.toThrow(/inside/);
  await expect(
    async () => await f.region("Same", rectangle([0, 0, 4000, 4000]), id)
  ).rejects.toThrow(/smaller/);
  await expect(
    async () => await f.put({ ...view, region: { ...view.region, parentId: id } })
  ).rejects.toThrow(/cycle/);
  const child = await f.region("Next", rectangle([0, 0, 2000, 2000]), id);
  await expect(
    async () => await f.put({ ...view, region: { ...view.region, parentId: child } })
  ).rejects.toThrow(/cycle/);
  await expect(async () => await f.put({ id }, "removeView")).rejects.toThrow(/children/);
  await expect(
    async () =>
      await f.put({
        ...view,
        region: { ...view.region, footprint: rectangle([2500, 2500, 4000, 4000]) },
      })
  ).rejects.toThrow(/child/);
});
it("reuses sibling borders and keeps cartographic compositions linked to their subject", async () => {
  const f = fixture(),
    parent = await f.region("Coast country", rectangle([0, 0, 10_000, 10_000]));
  const west = await f.region("West", rectangle([0, 0, 5000, 10_000]), parent);
  const world = fixtureState(f.world.id).snapshot.world;
  expect(spatial.canonical(availableRegionFootprint(world, f.areaId, parent)!)).toEqual(
    spatial.canonical(rectangle([5000, 0, 10_000, 10_000]))
  );
  await expect(
    async () => await f.region("Overlapping", rectangle([4000, 0, 6000, 10_000]), parent)
  ).rejects.toThrow(/sibling/);
  await f.region("East", rectangle([5000, 0, 10_000, 10_000]), parent);
  expect(
    availableRegionFootprint(fixtureState(f.world.id).snapshot.world, f.areaId, parent)
  ).toBeNull();
  await f.put({
    id: crypto.randomUUID(),
    name: "Political sheet",
    areaId: f.areaId,
    regionId: west,
    layers: [],
  });
  await expect(async () => await f.put({ id: west }, "removeView")).rejects.toThrow(
    /saved map views/
  );
});

describe("region line snapping", () => {
  const parent: Geometry = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [9000, 0],
        [10_000, 6000],
        [6000, 10_000],
        [0, 10_000],
        [0, 0],
      ],
    ],
  };
  it("snaps cut endpoints to the existing parent edge without moving interior bends", async () => {
    const line = snapRegionCut(
      {
        type: "LineString",
        coordinates: [
          [20, 5000],
          [2000, 5100],
          [8990, 0],
        ],
      },
      [parent],
      30
    );
    expect(line.coordinates).toEqual([
      [0, 5000],
      [2000, 5100],
      [8990, 0],
    ]);
  });
});
