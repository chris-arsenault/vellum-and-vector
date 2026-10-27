import {
  fixtureWorld,
  fixtureState,
  commitFixtureRecords,
  undoWorld,
  readScene,
} from "./testSupport/workspaceFixture";
import { expect, it } from "vitest";
import { rectangle } from "@atlas/domain";
import type { AtlasFeature, World } from "./types";

function feature(world: World, id: string, x = 50): AtlasFeature {
  return {
    id,
    name: id,
    areaId: Object.keys(world.areas)[0],
    layerId: "roads",
    kind: "road",
    geometry: {
      type: "LineString",
      coordinates: [
        [x, 50],
        [x + 40, 90],
      ],
    },
    attributes: {},
    relations: [],
    detail: {},
    state: "authored",
    actor: "user",
    protected: true,
    generationId: null,
    causes: [],
  };
}
async function replace(world: World, change: (world: World) => void) {
  const snapshot = structuredClone(fixtureState(world.id).snapshot);
  change(snapshot.world);
  return commitFixtureRecords(
    world.id,
    Object.values(snapshot.world.features).map((value) => ({ kind: "feature", value }))
  );
}
it("includes both an independently moved site and its retained surroundings", async () => {
  const world = fixtureWorld({ name: "Independent roles", seed: 1, width: 1000, height: 1000 }),
    area = Object.keys(world.areas)[0];
  world.features.site = {
    ...feature(world, "site"),
    geometry: { type: "Point", coordinates: [800, 800] },
    footprint: rectangle([100, 100, 300, 300]),
  };
  expect((await readScene(world.id, area, [790, 790, 810, 810])).map((f) => f.id)).toEqual([
    "site",
  ]);
  expect((await readScene(world.id, area, [150, 150, 250, 250])).map((f) => f.id)).toEqual([
    "site",
  ]);
  expect(await readScene(world.id, area, [500, 500, 600, 600])).toEqual([]);
});
it("preserves composed geography across unrelated edits and restores it on undo", async () => {
  let world = fixtureWorld({ name: "Index", seed: 1, width: 1000, height: 1000 });
  const area = Object.keys(world.areas)[0];
  world.features.a = feature(world, "a");
  const original = (await readScene(world.id, area))[0];
  expect((await readScene(world.id, area, [50, 50, 55, 55]))[0]).toEqual(original);
  expect(await readScene(world.id, area, [500, 500, 600, 600])).toEqual([]);
  world = (
    await replace(world, (w) => {
      w.features.b = feature(w, "b", 500);
    })
  ).world;
  expect((await readScene(world.id, area)).find((f) => f.id === "a")).toEqual(original);
  const edited = await replace(world, (w) => {
    w.features.a.geometry = { type: "Point", coordinates: [800, 800] };
  });
  expect(await readScene(world.id, area, [50, 50, 100, 100])).toEqual([]);
  expect((await readScene(world.id, area, [790, 790, 810, 810]))[0].geometry).toEqual({
    type: "Point",
    coordinates: [800, 800],
  });
  await undoWorld(world.id, edited.operation);
  expect((await readScene(world.id, area, [50, 50, 100, 100]))[0].geometry).toEqual(
    original.geometry
  );
});
it("invalidates following geometry when its target changes and clips bounded queries to area scope", async () => {
  const world = fixtureWorld({ name: "Bindings", seed: 1, width: 1000, height: 1000 });
  const area = Object.keys(world.areas)[0];
  world.features.a = feature(world, "a");
  world.features.b = { ...feature(world, "b"), relations: [{ kind: "follows", targetId: "a" }] };
  const original = (await readScene(world.id, area)).find((f) => f.id === "b")!;
  await replace(world, (w) => {
    w.features.a.geometry = {
      type: "LineString",
      coordinates: [
        [200, 200],
        [300, 300],
      ],
    };
  });
  const changed = (await readScene(world.id, area)).find((f) => f.id === "b")!;
  expect(changed.geometry).not.toEqual(original.geometry);
  expect(changed.geometry).toEqual(
    (await readScene(world.id, area)).find((f) => f.id === "a")!.geometry
  );
  expect(await readScene(world.id, area, [1000, 1000, 1100, 1100])).toEqual([]);
});
it("updates detailed geometry with area footprints and excludes other located floors", async () => {
  const world = fixtureWorld({ name: "Refinement", seed: 1, width: 1000, height: 1000 });
  const root = Object.values(world.areas)[0];
  const child = {
    ...root,
    id: "child",
    parentId: root.id,
    profile: "region" as const,
    footprint: rectangle([20, 20, 150, 150]),
  };
  world.areas.child = child;
  world.areas.floor = {
    ...child,
    id: "floor",
    spaceId: "upper-space",
    profile: "interior",
    frame: { ...child.frame, floor: "upper" },
  };
  world.features.a = feature(world, "a");
  world.features.inside = { ...feature(world, "inside"), areaId: "floor" };
  world.features.regional = {
    ...feature(world, "regional"),
    areaId: "child",
    kind: "dam",
    layerId: "waterworks",
  };
  world.features.a.detail.child = {
    geometry: {
      type: "LineString",
      coordinates: [
        [40, 40],
        [120, 40],
      ],
    },
    attributes: { detail: true },
    state: "authored",
    protected: true,
    actor: "user",
    generationId: null,
    needsReconciliation: false,
  };
  const composed = (await readScene(world.id, "child"))[0];
  expect((await readScene(world.id, root.id)).map((f) => f.id)).toEqual(["a"]);
  expect((await readScene(world.id, root.id))[0].geometry).toEqual(world.features.a.geometry);
  expect((await readScene(world.id, root.id, [40, 40, 90, 90])).map((f) => f.id)).toEqual(["a"]);
  expect((await readScene(world.id, "child")).some((f) => f.id === "regional")).toBe(true);
  expect(composed.attributes).toEqual({ detail: true });
  expect(composed.state).toBe("authored");
  expect(composed.protected).toBe(true);
  expect((await readScene(world.id, "child")).some((f) => f.id === "inside")).toBe(false);
  expect((await readScene(world.id, "floor")).map((f) => f.id)).toEqual(["inside"]);
  expect(await readScene(world.id, "child", [200, 200, 300, 300])).toEqual([]);
  await replace(world, (w) => {
    w.features.a.detail.child.geometry = {
      type: "LineString",
      coordinates: [
        [50, 60],
        [120, 60],
      ],
    };
  });
  expect((await readScene(world.id, "child"))[0].geometry).not.toEqual(composed.geometry);
});
