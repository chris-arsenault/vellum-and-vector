import { expect, it } from "vitest";
import {
  rectangle,
  refinedRegionArea,
  regionRefinementInput,
  regionLineage,
  presentAtlasFeature,
  type AtlasFeature,
} from "@atlas/domain";
import { createWorld, session, undoWorld } from "./atlasState";
import { commitCommand } from "./atlasCommands";

function fixture() {
  const world = createWorld({ name: "Refinement", seed: 13, width: 100_000, height: 100_000 }),
    source = Object.keys(world.areas)[0];
  const current = () => session(world.id).snapshot.world;
  const command = (kind: string, data: Record<string, unknown>) =>
    commitCommand(world.id, {
      operationId: crypto.randomUUID(),
      expectedVersion: current().version,
      kind,
      data,
    });
  const region = (span: number, parentId: string | null = null) => {
    const id = crypto.randomUUID();
    command("putView", {
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
it("links arbitrary recursive geographic refinement to existing selected subjects", () => {
  const f = fixture(),
    original = structuredClone(f.current().areas[f.source]);
  let parent: string | null = null,
    parentArea = f.source;
  for (const span of [80_000, 40_000, 20_000, 10_000]) {
    const id = f.region(span, parent);
    f.command("createArea", regionRefinementInput(f.current(), id));
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
it("rejects duplicate, mismatched and unsupported refinements and preserves undo", () => {
  const f = fixture(),
    id = f.region(40_000),
    input = regionRefinementInput(f.current(), id);
  expect(() => f.command("createArea", { ...input, profile: "site" })).toThrow(
    /geographic map type/
  );
  expect(() =>
    f.command("createArea", { ...input, footprint: rectangle([1000, 1000, 30_000, 30_000]) })
  ).toThrow(/outline/);
  f.command("createArea", input);
  expect(() => f.command("createArea", input)).toThrow(/existing refined map/);
  const view = f.current().views.find((v) => v.id === id)!;
  expect(() =>
    f.command("putView", {
      ...view,
      region: { ...view.region, footprint: rectangle([1000, 1000, 5000, 5000]) },
    })
  ).toThrow(/outline/);
  expect(() => f.command("removeView", { id })).toThrow(/region/);
  undoWorld(f.world.id, session(f.world.id).history[0].operationId);
  expect(refinedRegionArea(f.current(), id)).toBeUndefined();
  expect(f.current().views).toHaveLength(1);
});
it("owns fields recursively without disclosing a descendant's same-profile geography to its parent", () => {
  const f = fixture(),
    outer = f.region(80_000);
  f.command("createArea", regionRefinementInput(f.current(), outer));
  const parent = refinedRegionArea(f.current(), outer)!;
  f.command("createField", { areaId: parent.id, layerId: "elevation", resolution: 5, value: 200 });
  const inner = f.region(30_000, outer);
  f.command("createArea", regionRefinementInput(f.current(), inner));
  const child = refinedRegionArea(f.current(), inner)!;
  f.command("createField", { areaId: child.id, layerId: "elevation", resolution: 9, value: 200 });
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
