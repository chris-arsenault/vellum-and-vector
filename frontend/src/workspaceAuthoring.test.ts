import {
  fixtureWorld,
  fixtureState,
  undoWorld,
  commitCommand,
  previewCommand,
  readScene,
  readRaster,
  exportWorld,
} from "./testSupport/workspaceFixture";
import { it, expect } from "vitest";
import { saveTemplate } from "./atlasTemplates";
import { rectangle, sample, type Command, type World } from "@atlas/domain";

function command(world: World, kind: string, data: Record<string, unknown>): Command {
  return { operationId: crypto.randomUUID(), expectedVersion: world.version, kind, data };
}
const world = () => fixtureWorld({ name: "Atlas", seed: 104729, width: 100000, height: 100000 });

it("previews without mutation, rejects invalid edits atomically, and undoes through a new revision", async () => {
  const initial = world(),
    areaId = Object.keys(initial.areas)[0],
    id = crypto.randomUUID();
  const input = command(initial, "putFeature", {
    areaId,
    feature: {
      id,
      name: "Marker",
      kind: "poi",
      layerId: "pois",
      geometry: { type: "Point", coordinates: [20, 30] },
      attributes: {},
      relations: [],
      protected: true,
    },
  });
  expect((await previewCommand(initial.id, input)).candidate.features[id].name).toBe("Marker");
  expect(fixtureState(initial.id).snapshot.world.features).toEqual({});
  const committed = (await commitCommand(initial.id, input)).candidate;
  expect((await readScene(initial.id, areaId))[0].protected).toBe(true);
  await expect(async () => await commitCommand(initial.id, input)).rejects.toThrow("world changed");
  const invalid = command(committed, "putFeature", {
    areaId,
    feature: { ...committed.features[id], geometry: { type: "Point", coordinates: [-1, 30] } },
  });
  await expect(async () => await commitCommand(initial.id, invalid)).rejects.toThrow();
  expect(fixtureState(initial.id).snapshot.world.version).toBe(2);
  expect((await exportWorld(initial.id)).worldReference.units).toBe("metre");
  expect((await undoWorld(initial.id, input.operationId)).version).toBe(3);
  expect(await readScene(initial.id, areaId)).toEqual([]);
});

it("creates skipped profiles, sculpts fields and keeps changes out of other worlds", async () => {
  const initial = world(),
    other = world(),
    root = Object.keys(initial.areas)[0];
  const created = (
    await commitCommand(
      initial.id,
      command(initial, "createArea", {
        parentId: root,
        name: "Site",
        profile: "site",
        footprint: rectangle([100, 100, 500, 500]),
        frame: { origin: { x: 100, y: 100, z: 0 }, rotation: 0, metresPerUnit: 1, floor: null },
        approach: "manual",
        traits: [],
      })
    )
  ).candidate;
  const areaId = Object.values(created.areas).find((a) => a.parentId)!.id;
  expect(created.areas[areaId].boundary).not.toBeNull();
  const fields = (
    await commitCommand(
      initial.id,
      command(created, "createField", { areaId, layerId: "elevation", resolution: 9, value: 0 })
    )
  ).candidate;
  await commitCommand(
    initial.id,
    command(fields, "sculptField", {
      areaId,
      channel: "elevation",
      center: { x: 300, y: 300, z: 0 },
      radius: 100,
      delta: 50,
    })
  );
  const peak = sample(
    (await readRaster(initial.id, fields.fields[0].id, "elevation")).field,
    "elevation",
    {
      x: 300,
      y: 300,
      z: 0,
    }
  );
  expect(peak).toBeGreaterThan(48);
  expect(peak).toBeLessThanOrEqual(50);
  expect(Object.keys(fixtureState(other.id).snapshot.world.areas)).toHaveLength(1);
});

it("instantiates a detached template with independent identities and a rotated metric world anchor", async () => {
  const initial = world(),
    root = Object.keys(initial.areas)[0];
  const site = (
    await commitCommand(
      initial.id,
      command(initial, "createArea", {
        parentId: root,
        name: "Town",
        profile: "site",
        footprint: rectangle([100, 100, 1000, 1000]),
        frame: { origin: { x: 100, y: 100, z: 0 }, rotation: 0, metresPerUnit: 1, floor: null },
        approach: "manual",
        traits: [],
      })
    )
  ).candidate;
  const areaId = Object.values(site.areas).find((a) => a.parentId)!.id;
  const definition = saveTemplate({
    id: crypto.randomUUID(),
    name: "Inn",
    profile: "interior",
    parentProfiles: ["site"],
    footprint: rectangle([0, 0, 10, 10]),
    traits: [],
    frame: { origin: { x: 0, y: 0, z: 0 }, rotation: 0, metresPerUnit: 1, floor: null },
    features: [
      {
        id: crypto.randomUUID(),
        name: "Hall",
        areaId: "detached",
        kind: "room",
        layerId: "structures",
        geometry: rectangle([0, 0, 10, 10]),
        detail: {},
        attributes: {},
        relations: [],
        state: "authored",
        protected: true,
        actor: "user",
        generationId: null,
        causes: [],
      },
    ],
  });
  const result = (
    await commitCommand(
      initial.id,
      command(site, "instantiateTemplate", {
        parentId: areaId,
        templateId: definition.id,
        definitionVersion: definition.version,
        name: "Located inn",
        frame: {
          origin: { x: 300, y: 300, z: 5 },
          rotation: 90,
          metresPerUnit: 1,
          floor: "ground",
        },
        contextFeatureId: null,
        bindings: {},
      })
    )
  ).candidate;
  const interior = Object.values(result.areas).find((a) => a.profile === "interior")!;
  expect(interior.parentId).toBe(areaId);
  expect(interior.frame.origin).toEqual({ x: 300, y: 300, z: 5 });
  expect((await readScene(result.id, interior.id)).find((f) => f.name === "Hall")?.id).not.toBe(
    definition.features[0].id
  );
  expect(definition.features[0].geometry).toEqual(rectangle([0, 0, 10, 10]));
});
it("publishes landform geometry and sampled changes together, then undoes both", async () => {
  const initial = world(),
    areaId = Object.keys(initial.areas)[0];
  const fields = (
    await commitCommand(
      initial.id,
      command(initial, "createField", {
        areaId,
        layerId: "elevation",
        resolution: 9,
        value: 0,
      })
    )
  ).candidate;
  const operation = command(fields, "putLandform", {
    areaId,
    name: "Authored hill",
    center: { x: 50000, y: 50000, z: 0 },
    radius: 20000,
    height: 60,
  });
  const result = (await commitCommand(initial.id, operation)).candidate;
  expect(Object.values(result.features).find((f) => f.name === "Authored hill")).toBeDefined();
  const peak = sample(
    (await readRaster(initial.id, fields.fields[0].id, "elevation")).field,
    "elevation",
    {
      x: 50000,
      y: 50000,
      z: 0,
    }
  );
  expect(peak).toBeGreaterThan(58);
  expect(peak).toBeLessThanOrEqual(60);
  await undoWorld(initial.id, operation.operationId);
  expect(await readScene(initial.id, areaId)).toEqual([]);
  expect(
    sample((await readRaster(initial.id, fields.fields[0].id, "elevation")).field, "elevation", {
      x: 50000,
      y: 50000,
      z: 0,
    })
  ).toBe(0);
});

it("routes an authored road across sampled terrain and creates its network topology", async () => {
  const initial = world(),
    areaId = Object.keys(initial.areas)[0];
  const fields = (
    await commitCommand(
      initial.id,
      command(initial, "createField", {
        areaId,
        layerId: "elevation",
        resolution: 9,
        value: 10,
      })
    )
  ).candidate;
  const result = (
    await commitCommand(
      initial.id,
      command(fields, "routeNetwork", {
        areaId,
        name: "Survey road",
        kind: "road",
        waypoints: [
          { x: 10000, y: 10000, z: 0 },
          { x: 90000, y: 90000, z: 0 },
        ],
        startFeatureId: null,
        endFeatureId: null,
        flow: 0,
      })
    )
  ).candidate;
  const road = Object.values(result.features).find((f) => f.name === "Survey road")!;
  expect(road.geometry.type).toBe("LineString");
  expect(road.protected).toBe(true);
  expect(Object.values(result.networkReaches ?? {}).some((r) => r.featureId === road.id)).toBe(
    true
  );
});
