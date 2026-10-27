import { describe, expect, it } from "vitest";
import {
  rectangle,
  type AtlasFeature,
  type CatalogRecord,
  type ReadRequirements,
  spatial,
} from "@atlas/domain";
import { fixture, scope, world, record, write, query } from "./catalogFixture";
it("generalizes display geometry while preserving the canonical source and edit revisions", async () => {
  const catalog = await fixture();
  const geometry = {
    type: "LineString" as const,
    coordinates: Array.from({ length: 101 }, (_, i) => [i * 9, 500 + Math.sin(i) * 2]),
  };
  await write(catalog, [record("course", geometry)]);
  const canonical = (await catalog.readFeature(scope, "course")).geometry;
  const shown = (await catalog.readDisplay(query(), 8)).records[0].feature.geometry;
  expect(shown.type).toBe("LineString");
  if (shown.type !== "LineString") throw new Error("Missing line.");
  expect(shown.coordinates.length).toBeLessThan(geometry.coordinates.length);
  expect((await catalog.readFeature(scope, "course")).geometry).toEqual(canonical);
  const rename = (await catalog.readRecords(scope, "feature", ["course"]))[0];
  if (rename.data.kind !== "feature") throw new Error("Missing course.");
  rename.data.value.name = "Named course";
  await write(catalog, [rename]);
  expect((await catalog.readDisplay(query(), 8)).records[0].feature.name).toBe("Named course");
  expect((await catalog.readFeature(scope, "course")).geometry).toEqual(canonical);
});
it("uses exact geometry after RTree candidates, including holes and covered boundary points", async () => {
  const catalog = await fixture();
  await write(catalog, [
    record("wood", {
      type: "Polygon",
      coordinates: [
        [
          [10, 10],
          [100, 10],
          [100, 100],
          [10, 100],
          [10, 10],
        ],
        [
          [40, 40],
          [40, 60],
          [60, 60],
          [60, 40],
          [40, 40],
        ],
      ],
    }),
  ]);
  const at = (x: number) =>
    catalog.readFeatures(
      query({
        extent: [x, 50, x, 50],
        geometry: { type: "Point", coordinates: [x, 50] },
        predicate: "covers",
      })
    );
  expect((await at(50)).records).toHaveLength(0);
  expect((await at(10)).records[0].feature.id).toBe("wood");
  await expect(
    catalog.readFeatures(query({ scope: { ...scope, spaceId: "cave" } }))
  ).rejects.toThrow(/located space/);
  expect((await catalog.readFeatures(query({ layers: ["roads"] }))).records).toEqual([]);
});
it("paginates exact matches and retains unchanged geometry revisions", async () => {
  const catalog = await fixture();
  await write(catalog, [record("a"), record("b"), record("c")]);
  const first = await catalog.readFeatures(query({ limit: 2 }));
  expect(first.records.map((r) => r.feature.id)).toEqual(["a", "b"]);
  expect(first.next).toBe("b");
  expect(
    (await catalog.readFeatures(query({ after: first.next }))).records.map((r) => r.feature.id)
  ).toEqual(["c"]);
  const changed = record("b", rectangle([300, 300, 400, 400]));
  changed.reference.revision = 2;
  await write(catalog, [changed]);
  expect(
    (await catalog.readFeatures(query({ extent: [0, 0, 150, 150] }))).records.map(
      (r) => r.feature.id
    )
  ).toEqual(["a", "c"]);
  expect((await catalog.readRecords(scope, "feature", ["a"]))[0].reference.revision).toBe(2);
});
describe("catalog transactions", () => {
  it("rolls back geometry and index writes together and refuses stale publication", async () => {
    const catalog = await fixture();
    await write(catalog, [record("a")]);
    const changed = record("a", rectangle([300, 300, 400, 400]));
    await expect(write(catalog, [changed])).rejects.toThrow(/changed/);
    const bad = record("b");
    bad.data = {
      kind: "feature",
      value: { ...record("b").data.value, id: "wrong" } as AtlasFeature,
    };
    await expect(write(catalog, [record("new"), bad])).rejects.toThrow(/identity/);
    expect((await catalog.readFeatures(query())).records.map((r) => r.feature.id)).toEqual(["a"]);
    expect((await catalog.readWorld(scope.worldId)).version).toBe(2);
  });
  it("assigns distinct commit revisions to independent concurrent operations", async () => {
    const catalog = await fixture();
    const results = await Promise.all([
      write(catalog, [record("a")]),
      write(catalog, [record("b")]),
    ]);
    expect(results.map((r) => r.revision)).toEqual([2, 3]);
  });
});

async function locatedFixture() {
  const catalog = await fixture();
  const rootRecord = (await catalog.readRecords(scope, "area", [scope.areaId]))[0];
  if (rootRecord.data.kind !== "area") throw new Error("Missing root fixture.");
  const childScope = { ...scope, areaId: "child" };
  const child: CatalogRecord = {
    scope: childScope,
    reference: { kind: "area", id: "child", revision: 0 },
    data: {
      kind: "area",
      value: {
        ...rootRecord.data.value,
        id: "child",
        parentId: scope.areaId,
        profile: "region",
        footprint: rectangle([200, 200, 800, 800]),
      },
    },
  };
  const course = record("course", {
    type: "LineString",
    coordinates: [
      [0, 500],
      [1000, 500],
    ],
  });
  const follower = record("follower", {
    type: "LineString",
    coordinates: [
      [10, 10],
      [20, 20],
    ],
  });
  if (follower.data.kind === "feature")
    follower.data.value.relations = [{ kind: "follows", targetId: "course" }];
  await write(catalog, [child, course, follower, record("unrelated")]);
  await write(catalog, [
    {
      scope: childScope,
      reference: { kind: "representation", id: "course-detail", revision: 0 },
      data: {
        kind: "representation",
        value: {
          id: "course-detail",
          featureId: "course",
          areaId: "child",
          geometry: {
            type: "LineString",
            coordinates: [
              [200, 600],
              [800, 600],
            ],
          },
          attributes: { width: 123 },
          state: "authored",
          actor: "user",
          protected: true,
          mapOnly: true,
          generationId: null,
          needsReconciliation: false,
        },
      },
    },
  ]);
  return { catalog, childScope };
}
describe("located canonical reads", () => {
  it("resolves finer authored courses and following identities without unrelated features", async () => {
    const { catalog, childScope } = await locatedFixture();
    const page = await catalog.readFeatures(
      query({ scope: childScope, extent: [490, 590, 510, 610] })
    );
    expect(page.records.map((r) => r.feature.id)).toEqual(["course", "follower"]);
    expect(page.records.find((r) => r.feature.id === "course")?.feature).toMatchObject({
      protected: true,
      mapOnly: true,
      attributes: { width: 123 },
    });
    expect(
      (await catalog.readFeatures(query({ extent: [490, 490, 510, 510] }))).records.map(
        (r) => r.feature.id
      )
    ).toEqual(["course", "follower"]);
    const reads: ReadRequirements = {
      scope: {
        worldId: world.id,
        areaId: "child",
        spaceId: scope.spaceId,
        crsId: world.reference.id,
        revision: (await catalog.readWorld(world.id)).version,
        footprint: rectangle([200, 200, 800, 800]),
        time: "present",
        resolution: null,
      },
      objects: [{ kind: "feature", ids: ["course"] }],
      spatialLayers: [],
      channels: [],
      parentHistory: [],
      dependencies: true,
    };
    const projection = await catalog.readAuthoring(reads);
    expect(Object.keys(projection.world.features).sort()).toEqual(["course", "follower"]);
    expect(Object.keys(projection.world.areas).sort()).toEqual(["child", "root"]);
    expect(projection.numerical).toEqual({});
    expect(projection.world.features.course.detail.child).toMatchObject({
      protected: true,
      mapOnly: true,
    });
  });
});
describe("composed boundary topology", () => {
  it("keeps parent topology stable while a finer representation changes its connected faces", async () => {
    const { catalog, childScope } = await locatedFixture();
    const pick = (areaId: string, x: number, y: number) =>
      catalog.regionChoices({
        scope: { ...scope, areaId },
        sourceAreaId: areaId,
        parentId: null,
        editingId: null,
        cuts: [],
        position: { x, y, z: 0 },
        viewport: [0, 0, 1000, 1000],
      });
    const rootFaceArea = 500_000 - 90 * 90; // The unrelated woodland is a hole in this face.
    expect(spatial.area((await pick("root", 500, 300)).candidates[0].footprint)).toBeCloseTo(
      rootFaceArea
    );
    expect(spatial.area((await pick("child", 500, 300)).candidates[0].footprint)).toBeCloseTo(
      240_000
    );
    const detail = (await catalog.readRecords(childScope, "representation", ["course-detail"]))[0];
    if (detail.data.kind !== "representation") throw new Error("Missing representation fixture.");
    detail.data.value.geometry = {
      type: "LineString",
      coordinates: [
        [200, 400],
        [800, 400],
      ],
    };
    await write(catalog, [detail]);
    expect(spatial.area((await pick("child", 500, 300)).candidates[0].footprint)).toBeCloseTo(
      120_000
    );
    expect(spatial.area((await pick("root", 500, 300)).candidates[0].footprint)).toBeCloseTo(
      rootFaceArea
    );
  });
});

it("filters and sorts the entire registry before paging, and refreshes edited values", async () => {
  const catalog = await fixture();
  const records = Array.from({ length: 130 }, (_, i) => {
    const item = record(`town-${String(i).padStart(3, "0")}`);
    if (item.data.kind === "feature")
      Object.assign(item.data.value, {
        kind: "settlement",
        layerId: "settlements",
        name: `Town ${i}`,
        attributes: { population: i * 10, nameStatus: i === 129 ? "label" : "proper" },
      });
    return item;
  });
  await write(catalog, records);
  const input = {
    worldId: scope.worldId,
    page: 0,
    limit: 25,
    sort: { key: "population", descending: true },
    query: {
      search: "Town",
      type: "",
      status: "",
      state: "",
      profile: "",
      space: "",
      named: true,
      protectedOnly: false,
      attributes: [{ key: "population", min: "1000", max: "", text: "" }],
    },
  };
  const first = await catalog.readRegistry(input);
  expect(first).toMatchObject({ total: 130, matching: 29, page: 0 });
  expect(first.rows[0].feature.id).toBe("town-128");
  expect(first.rows).toHaveLength(25);
  expect((await catalog.readRegistry({ ...input, page: 1 })).rows).toHaveLength(4);
  expect(first.facets.types).toHaveLength(1);
  expect(first.columns.find((column) => column.key === "population")?.numeric).toBe(true);
  const changed = (await catalog.readRecords(scope, "feature", ["town-128"]))[0];
  if (changed.data.kind !== "feature") throw new Error("Missing town.");
  changed.data.value.attributes.population = 1;
  await write(catalog, [changed]);
  expect((await catalog.readRegistry(input)).matching).toBe(28);
  expect((await catalog.readRegistry({ ...input, extent: [200, 200, 300, 300] })).total).toBe(0);
});

it("keeps retained society out of editor metadata and reads just one settlement's context", async () => {
  const catalog = await fixture();
  const community = (id: string) => ({
    id,
    name: id,
    position: { x: 20, y: 20, z: 0 },
    areaKm2: 1,
    groups: [],
    support: { farming: 0, grazing: 0, gathering: 0, fishing: 0, water: 1, capacity: 20 },
    founded: "First era",
    status: "inhabited" as const,
    protected: false,
    causes: [],
  });
  const society: CatalogRecord = {
    scope,
    reference: { kind: "society", id: "society:root", revision: 0 },
    data: {
      kind: "society",
      value: {
        id: "society:root",
        areaId: "root",
        spaceId: "surface",
        communities: [community("near"), community("far"), community("unrelated")],
        connections: [{ from: "near", to: "far", kind: "land", distance: 200, travelCost: 1 }],
        history: [],
        works: [],
        events: [],
        magic: [],
      },
    },
  };
  const town = record("town");
  if (town.data.kind !== "feature") throw new Error("Missing town.");
  town.data.value.kind = "settlement";
  town.data.value.attributes.communityId = "near";
  await write(catalog, [town, society]);
  expect(await catalog.readWorld(scope.worldId)).not.toHaveProperty("societies");
  expect(await catalog.readEditor(scope.worldId)).not.toHaveProperty("societies");
  const result = await catalog.readSettlement(scope, "town");
  expect(result?.region.communities.map((c) => c.id)).toEqual(["near", "far"]);
  expect(result?.related.map((f) => f.id)).toEqual(["town"]);
  const history = await catalog.readHistory(scope.worldId, null, 1);
  await catalog.undo(scope.worldId, history[0].operationId);
  expect(await catalog.readRecords(scope, "society", ["society:root"])).toEqual([]);
});
