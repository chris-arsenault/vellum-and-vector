import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { rectangle, type AtlasFeature, type TemplateDefinition } from "@atlas/domain";
import { testDatabase } from "../testDatabase";
import { Database } from "./database";
import { seedSpatialWorld } from "./spatialFixtures";
import { TemplateRepository } from "./templates";

function entrance(area: string, door: string): AtlasFeature {
  return {
    id: door,
    areaId: area,
    name: "Main entrance",
    kind: "door",
    layerId: "doors",
    geometry: { type: "Point", coordinates: [7.5, 0] },
    detail: {},
    attributes: { width: 1.2 },
    relations: [],
    state: "authored",
    protected: true,
    actor: "user:alice",
    generationId: null,
    causes: [],
  };
}
function tavern(): TemplateDefinition {
  const id = randomUUID(),
    area = randomUUID(),
    door = randomUUID();
  const footprint = rectangle([0, 0, 15, 10]);
  return {
    id,
    version: 1,
    name: "Roadside tavern",
    units: "metre",
    rootAreaId: area,
    parentProfiles: ["local", "site"],
    areas: [
      {
        id: area,
        name: "Ground floor",
        parentId: null,
        profile: "interior",
        footprint,
        frame: { origin: { x: 0, y: 0, z: 0 }, rotation: 0, metresPerUnit: 1, floor: "ground" },
        version: 1,
        traits: [],
        localTraits: [],
        layers: { doors: "authored" },
        boundary: null,
        templateId: null,
        context: "building",
      },
    ],
    features: [entrance(area, door)],
    entities: [],
    layers: [
      {
        id: "doors",
        name: "Doors",
        family: "built",
        representation: "vector",
        color: "#987654",
        profiles: ["interior"],
        schema: { width: { type: "number", unit: "metre" } },
        generator: null,
      },
    ],
    nodes: [],
    reaches: [],
    connections: [],
    sockets: [
      {
        id: "main",
        featureId: door,
        position: { x: 7.5, y: 0, z: 0 },
        kind: "entrance",
        required: true,
        targetKinds: ["street"],
        spaceId: area,
        connectsTo: null,
      },
    ],
    requirements: {
      contextKinds: ["building"],
      fields: [
        { field: "slope", kind: "hard", minimum: 0, maximum: 0.2, cause: null, scope: null },
      ],
      maximumSlope: 0.2,
      streetAccess: true,
    },
    workflow: null,
    contextReferences: [],
  };
}
it("stores detached template versions, typed constraints, context references and protected authored content", async () => {
  const db = await testDatabase();
  try {
    const database = new Database(db.client),
      data = await database.transaction(seedSpatialWorld);
    const repository = new TemplateRepository(database),
      input = tavern();
    input.contextReferences = [{ id: data.feature.id, worldId: data.world.id, kind: "feature" }];
    input.features[0].relations = [{ targetId: data.feature.id, kind: "faces" }];
    const first = await repository.save("alice", input, null);
    expect(first.requirements).toEqual(input.requirements);
    expect(first.features).toEqual(input.features.map((f) => ({ ...f, generationDomain: null })));
    expect(first.sockets).toEqual(input.sockets);
    expect(first.contextReferences).toEqual(input.contextReferences);
    const second = await repository.save(
      "alice",
      { ...input, version: 2, name: "Tavern revised" },
      1
    );
    expect(second.version).toBe(2);
    expect((await repository.read("alice", input.id, 1)).name).toBe("Roadside tavern");
    expect((await repository.list("alice"))[0].version).toBe(2);
    await expect(repository.read("bob", input.id)).rejects.toThrow("not found");
    await expect(repository.save("alice", { ...input, version: 2 }, 1)).rejects.toThrow("latest");
    await expect(
      db.client.query("UPDATE atlas_features SET name='changed' WHERE id=$1 AND scope_id<>$2", [
        input.features[0].id,
        data.world.id,
      ])
    ).rejects.toThrow("immutable");
  } finally {
    await db.close();
  }
});
