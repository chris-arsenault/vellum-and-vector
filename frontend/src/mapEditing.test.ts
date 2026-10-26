import { expect, it } from "vitest";
import { proceduralSnapshot, restoreMappedEdits, sample } from "@atlas/domain";
import { mapEditingFixture } from "./mapEditingFixture";
import { readFeature, readRaster, exportWorld } from "./atlasReads";
import { session, undoWorld } from "./atlasState";

it("reshapes a river's mapped region without inverse terrain, discharge or boundary reconstruction", () => {
  const f = mapEditingFixture(),
    before = structuredClone(f.current());
  const feature = readFeature(f.id, f.river, f.child);
  const geometry = {
    type: "LineString",
    coordinates: [
      [200, 200],
      [500, 350],
      [800, 800],
    ],
  };
  f.command("putMapFeature", {
    areaId: f.child,
    feature: {
      ...feature,
      geometry,
      attributes: { ...feature.attributes, elevations: [0, 2000, -500], discharge: 17 },
    },
  });
  expect(readFeature(f.id, f.river, f.child).geometry).toEqual({
    type: "MultiLineString",
    coordinates: [
      [
        [100, 100],
        [200, 200],
      ],
      [
        [800, 800],
        [900, 900],
      ],
      geometry.coordinates,
    ],
  });
  expect(readFeature(f.id, f.river, f.child).geometry).not.toEqual(
    before.world.features[f.river].geometry
  );
  expect(readFeature(f.id, f.river, f.root).geometry).toEqual(
    before.world.features[f.river].geometry
  );
  expect(f.current().world.features[f.river].geometry).toEqual(
    before.world.features[f.river].geometry
  );
  expect(f.current().world.areas[f.child].boundary).toEqual(before.world.areas[f.child].boundary);
  expect(f.current().world.networkNodes).toEqual(before.world.networkNodes);
  expect(f.current().world.networkReaches).toEqual(before.world.networkReaches);
  expect(f.current().numerical).toEqual(before.numerical);
  expect(proceduralSnapshot(f.current()).world.features[f.river]).toEqual(
    before.world.features[f.river]
  );
  expect(exportWorld(f.id).features.find((feature) => feature.id === f.river)?.geometry).toEqual(
    readFeature(f.id, f.river, f.child).geometry
  );
  expect(
    exportWorld(f.id, f.child).features.find((feature) => feature.id === f.river)?.properties
  ).toMatchObject({ discharge: 17 });
  expect(
    exportWorld(f.id, f.root).features.find((feature) => feature.id === f.river)?.properties
  ).toMatchObject({ discharge: 10 });
  undoWorld(f.id, session(f.id).history[0].operationId);
  expect(f.current().world.features).toEqual(before.world.features);
});

it("moves a mapped town and attached route together while preserving their procedural identities", () => {
  const f = mapEditingFixture(),
    before = structuredClone(f.current());
  const feature = readFeature(f.id, f.town, f.child);
  f.command("putMapFeature", {
    areaId: f.child,
    feature: { ...feature, geometry: { type: "Point", coordinates: [550, 450] } },
  });
  expect(readFeature(f.id, f.town, f.child).geometry).toEqual({
    type: "Point",
    coordinates: [550, 450],
  });
  const route = readFeature(f.id, f.road, f.child);
  expect(route.geometry).toEqual({
    type: "LineString",
    coordinates: [
      [550, 450],
      [650, 650],
    ],
  });
  expect(route.attributes.fromCommunity).toBe("known");
  expect(f.current().world.features[f.town].geometry).toEqual(
    before.world.features[f.town].geometry
  );
  expect(f.current().world.features[f.road].geometry).toEqual(
    before.world.features[f.road].geometry
  );
  expect(f.current().world.societies).toEqual(before.world.societies);
  expect(f.current().world.epochs).toEqual(before.world.epochs);
  undoWorld(f.id, session(f.id).history[0].operationId);
  expect(f.current().world.features).toEqual(before.world.features);
});

it("paints across frozen physical samples with a regional overlay, preserving source arrays and undo", () => {
  const f = mapEditingFixture(),
    before = structuredClone(f.current());
  const position = { x: 210, y: 400, z: 0 };
  f.command("paintMapField", {
    areaId: f.child,
    channel: "elevation",
    center: position,
    radius: 100,
    mode: "add",
    amount: 1000,
  });
  expect(
    sample(readRaster(f.id, f.field, "elevation", f.child).field, "elevation", position)
  ).toBeGreaterThan(1000);
  expect(sample(readRaster(f.id, f.field, "elevation", f.root).field, "elevation", position)).toBe(
    100
  );
  expect(f.current().numerical[f.field].channels).toEqual(before.numerical[f.field].channels);
  const procedural = proceduralSnapshot(f.current());
  expect(sample(procedural.numerical[f.field], "elevation", position)).toBe(100);
  expect(procedural.fieldPatches).toEqual(before.fieldPatches);
  const restored = structuredClone(procedural);
  restoreMappedEdits(restored, f.current());
  expect(restored.fieldPatches).toEqual(f.current().fieldPatches);
  expect(restored.numerical[f.field].overlays).toEqual(f.current().numerical[f.field].overlays);
  expect(f.current().world.areas[f.child].boundary).toEqual(before.world.areas[f.child].boundary);
  undoWorld(f.id, session(f.id).history[0].operationId);
  expect(f.current().numerical).toEqual(before.numerical);
});

it("keeps shared mapped crossings attached without imposing their numerical elevations", () => {
  const f = mapEditingFixture(),
    feature = readFeature(f.id, f.river, f.child);
  expect(() =>
    f.command("putMapFeature", {
      areaId: f.child,
      feature: {
        ...feature,
        geometry: {
          type: "LineString",
          coordinates: [
            [200, 300],
            [500, 350],
            [800, 700],
          ],
        },
      },
    })
  ).toThrow(/shared river junctions and region crossings/);
});

it("paints the visible parent surface without absorbing or overwriting an existing child drawing", () => {
  const f = mapEditingFixture(),
    position = { x: 400, y: 400, z: 0 };
  const brush = {
    channel: "elevation",
    center: position,
    radius: 100,
    mode: "add",
    falloff: "constant",
  };
  f.command("paintMapField", { ...brush, areaId: f.child, amount: 1000 });
  f.command("paintMapField", { ...brush, areaId: f.root, amount: 1 });
  expect(
    sample(readRaster(f.id, f.field, "elevation", f.root).field, "elevation", position)
  ).toBeCloseTo(101, 5);
  expect(
    sample(readRaster(f.id, f.field, "elevation", f.child).field, "elevation", position)
  ).toBeCloseTo(1100, 5);
});

it("moves a town's local route endpoint while retaining its connection across the region boundary", () => {
  const f = mapEditingFixture([900, 650]),
    before = structuredClone(f.current());
  const feature = readFeature(f.id, f.town, f.child);
  f.command("putMapFeature", {
    areaId: f.child,
    feature: { ...feature, geometry: { type: "Point", coordinates: [550, 450] } },
  });
  const route = readFeature(f.id, f.road, f.child);
  expect(route.geometry).toEqual({
    type: "MultiLineString",
    coordinates: [
      [
        [800, 612.5],
        [900, 650],
      ],
      [
        [550, 450],
        [800, 612.5],
      ],
    ],
  });
  expect(f.current().world.areas[f.child].boundary).toEqual(before.world.areas[f.child].boundary);
  expect(f.current().world.features[f.road].geometry).toEqual(
    before.world.features[f.road].geometry
  );
});
