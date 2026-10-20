import { expect, it } from "vitest";
import { rectangle } from "@atlas/domain";
import type { AtlasFeature, World } from "./types";
import { createWorld, session, publish, undoWorld } from "./atlasState";
import { readScene } from "./atlasReads";

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
function replace(world: World, change: (world: World) => void) {
  const snapshot = structuredClone(session(world.id).snapshot);
  snapshot.world.version++;
  change(snapshot.world);
  const operation = crypto.randomUUID();
  publish(world.id, snapshot, "test", operation);
  return { world: snapshot.world, operation };
}
it("reuses composed features across indexed viewport reads and unrelated edits, then invalidates undo", () => {
  let world = createWorld({ name: "Index", seed: 1, width: 1000, height: 1000 });
  const area = Object.keys(world.areas)[0];
  world.features.a = feature(world, "a");
  const original = readScene(world.id, area)[0];
  expect(readScene(world.id, area, [50, 50, 55, 55])[0]).toBe(original);
  expect(readScene(world.id, area, [500, 500, 600, 600])).toEqual([]);
  world = replace(world, (w) => {
    w.features.b = feature(w, "b", 500);
  }).world;
  expect(readScene(world.id, area).find((f) => f.id === "a")).toBe(original);
  const edited = replace(world, (w) => {
    w.features.a.geometry = { type: "Point", coordinates: [800, 800] };
  });
  expect(readScene(world.id, area, [50, 50, 100, 100])).toEqual([]);
  expect(readScene(world.id, area, [790, 790, 810, 810])[0].geometry).toEqual({
    type: "Point",
    coordinates: [800, 800],
  });
  undoWorld(world.id, edited.operation);
  expect(readScene(world.id, area, [50, 50, 100, 100])[0].geometry).toEqual(original.geometry);
});
it("invalidates following geometry when its target changes and clips bounded queries to area scope", () => {
  const world = createWorld({ name: "Bindings", seed: 1, width: 1000, height: 1000 });
  const area = Object.keys(world.areas)[0];
  world.features.a = feature(world, "a");
  world.features.b = { ...feature(world, "b"), relations: [{ kind: "follows", targetId: "a" }] };
  const original = readScene(world.id, area).find((f) => f.id === "b")!;
  replace(world, (w) => {
    w.features.a.geometry = {
      type: "LineString",
      coordinates: [
        [200, 200],
        [300, 300],
      ],
    };
  });
  const changed = readScene(world.id, area).find((f) => f.id === "b")!;
  expect(changed.geometry).not.toEqual(original.geometry);
  expect(changed.geometry).toEqual(readScene(world.id, area).find((f) => f.id === "a")!.geometry);
  expect(readScene(world.id, area, [1000, 1000, 1100, 1100])).toEqual([]);
});
it("updates detailed geometry with area footprints and excludes other located floors", () => {
  const world = createWorld({ name: "Refinement", seed: 1, width: 1000, height: 1000 });
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
  const composed = readScene(world.id, "child")[0];
  expect(composed.attributes).toEqual({ detail: true });
  expect(readScene(world.id, "child").some((f) => f.id === "inside")).toBe(false);
  expect(readScene(world.id, "floor").map((f) => f.id)).toEqual(["inside"]);
  expect(readScene(world.id, "child", [200, 200, 300, 300])).toEqual([]);
  replace(world, (w) => {
    w.features.a.detail.child.geometry = {
      type: "LineString",
      coordinates: [
        [50, 60],
        [120, 60],
      ],
    };
  });
  expect(readScene(world.id, "child")[0].geometry).not.toEqual(composed.geometry);
});
