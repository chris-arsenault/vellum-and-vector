import {
  fixtureWorld,
  fixtureState,
  undoWorld,
  commitCommand,
} from "./testSupport/workspaceFixture";
import { expect, it } from "vitest";
import {
  rectangle,
  refinedRegionArea,
  regionRefinementInput,
  regionLineage,
  presentAtlasFeature,
  type AtlasFeature,
} from "@atlas/domain";

function fixture() {
  const world = fixtureWorld({ name: "Refinement", seed: 13, width: 100_000, height: 100_000 }),
    source = Object.keys(world.areas)[0];
  const current = () => fixtureState(world.id).snapshot.world;
  const command = async (kind: string, data: Record<string, unknown>) =>
    await commitCommand(world.id, {
      operationId: crypto.randomUUID(),
      expectedVersion: current().version,
      kind,
      data,
    });
  const region = async (span: number, parentId: string | null = null) => {
    const id = crypto.randomUUID();
    await command("putView", {
      id,
      areaId: source,
      name: "A region",
      layers: [],
      region: { parentId, footprint: rectangle([1000, 1000, span, span]) },
    });
    return id;
  };
  return { world, source, current, command, region };
}
it("links arbitrary recursive geographic refinement to existing selected subjects", async () => {
  const f = fixture(),
    original = structuredClone(f.current().areas[f.source]);
  let parent: string | null = null,
    parentArea = f.source;
  for (const span of [80_000, 40_000, 20_000, 10_000]) {
    const id = await f.region(span, parent);
    await f.command("createArea", regionRefinementInput(f.current(), id));
    const area = refinedRegionArea(f.current(), id)!;
    expect(area.parentId).toBe(parentArea);
    expect(area.profile).toBe("region");
    expect(area.footprint).toEqual(
      f.current().views.find((view) => view.id === id)!.region!.footprint
    );
    expect(f.current().views.find((view) => view.id === id)!.areaId).toBe(f.source);
    parent = id;
    parentArea = area.id;
  }
  expect(regionLineage(f.current(), parent)).toHaveLength(4);
  expect(f.current().areas[f.source]).toEqual(original);
  expect(f.current().generations).toEqual([]);
});
it("rejects duplicate, mismatched and unsupported refinements and preserves undo", async () => {
  const f = fixture(),
    id = await f.region(40_000),
    input = regionRefinementInput(f.current(), id);
  await expect(
    async () => await f.command("createArea", { ...input, profile: "site" })
  ).rejects.toThrow(/geographic map type/);
  await expect(
    async () =>
      await f.command("createArea", {
        ...input,
        footprint: rectangle([1000, 1000, 30_000, 30_000]),
      })
  ).rejects.toThrow(/outline/);
  await f.command("createArea", input);
  await expect(async () => await f.command("createArea", input)).rejects.toThrow(
    /existing refined map/
  );
  const view = f.current().views.find((v) => v.id === id)!;
  await expect(
    async () =>
      await f.command("putView", {
        ...view,
        region: { ...view.region, footprint: rectangle([1000, 1000, 5000, 5000]) },
      })
  ).rejects.toThrow(/outline/);
  await expect(async () => await f.command("removeView", { id })).rejects.toThrow(/region/);
  await undoWorld(f.world.id, fixtureState(f.world.id).history[0].operationId);
  expect(refinedRegionArea(f.current(), id)).toBeUndefined();
  expect(f.current().views).toHaveLength(1);
});
it("owns fields recursively without disclosing a descendant's same-profile geography to its parent", async () => {
  const f = fixture(),
    outer = await f.region(80_000);
  await f.command("createArea", regionRefinementInput(f.current(), outer));
  const parent = refinedRegionArea(f.current(), outer)!;
  await f.command("createField", {
    areaId: parent.id,
    layerId: "elevation",
    resolution: 5,
    value: 200,
  });
  const inner = await f.region(30_000, outer);
  await f.command("createArea", regionRefinementInput(f.current(), inner));
  const child = refinedRegionArea(f.current(), inner)!;
  await f.command("createField", {
    areaId: child.id,
    layerId: "elevation",
    resolution: 9,
    value: 200,
  });
  expect(f.current().fields).toHaveLength(2);
  const place: AtlasFeature = {
    id: crypto.randomUUID(),
    name: "A smaller town",
    areaId: child.id,
    geometry: { type: "Point", coordinates: [5000, 5000] },
    layerId: "settlements",
    kind: "settlement",
    detail: {},
    attributes: {},
    protected: false,
    state: "generated",
    actor: "generator",
    generationId: null,
    relations: [],
    causes: [],
  };
  expect(presentAtlasFeature(f.current(), place, parent.id)).toBeNull();
  expect(presentAtlasFeature(f.current(), place, child.id)?.id).toBe(place.id);
  expect(presentAtlasFeature(f.current(), place, f.source)).toBeNull();
});
