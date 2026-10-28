import { expect, it } from "vitest";
import {
  createGrid,
  generateChannel,
  putChannel,
  rectangle,
  resampleChannels,
} from "@atlas/domain";
import { landscape } from "./mapFixtures";
import { regionalInputFields, regionalInputChannels, regionalResolution } from "./regionalInputs";

function fixture() {
  const { domain, surface } = landscape(),
    world = domain.world;
  world.areas.child = {
    ...world.areas.area,
    id: "child",
    parentId: "area",
    profile: "region",
    footprint: rectangle([1000, 0, 3000, 1000]),
  };
  world.areas.neighbor = { ...world.areas.child, id: "neighbor", parentId: "area" };
  const add = (id: string, areaId: string, width: number, elevation: number) => {
    const grid = createGrid(
      id,
      { ...surface.scope, areaId, footprint: world.areas[areaId].footprint },
      width,
      3
    );
    putChannel(
      grid,
      "elevation",
      "metre",
      generateChannel(grid, "elevation", () => elevation)
    );
    putChannel(
      grid,
      "stock",
      "amount",
      generateChannel(grid, "stock", (i) => grid.measures.get(i) * 2),
      "extensive"
    );
    domain.numerical[id] = grid;
    world.fields.push({
      id,
      areaId,
      layerId: "physical",
      samples: grid.active.length,
      algorithm: "fixture",
      source: { kind: "operation", id: "fixture" },
      channels: ["elevation", "stock"],
    });
    return grid;
  };
  return { domain, add };
}
it("selects finest ancestor inputs regardless of field order, excluding overlapping neighbors and itself", () => {
  const { domain, add } = fixture();
  add("fine", "area", 17, 200);
  add("coarse", "area", 5, 100);
  add("neighbor", "neighbor", 33, 999);
  add("self", "child", 33, 888);
  const channels = regionalInputChannels(regionalInputFields(domain, "child"));
  expect(channels.get("elevation")!.id).toBe("fine");
  expect(
    regionalInputChannels(regionalInputFields(domain, "child", false)).get("elevation")!.id
  ).toBe("self");
});
it("transfers amounts by physical area and resolves recursively within the same map profile", () => {
  const { domain, add } = fixture(),
    source = add("parent", "area", 5, 200);
  const resolution = regionalResolution(domain, "child", "standard"),
    target = createGrid(
      "target",
      { ...source.scope, areaId: "child", footprint: domain.world.areas.child.footprint },
      17,
      9
    );
  resampleChannels(source, target);
  expect(Array.from(target.channels.stock).reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(
    4_000_000,
    6
  );
  expect(Array.from(target.channels.elevation).every((height) => height === 200)).toBe(true);
  expect(target.quantities!.stock).toBe("extensive");
  expect(resolution.cellSpan).toBeLessThan(source.scope.resolution!);
  domain.world.areas.nested = {
    ...domain.world.areas.child,
    id: "nested",
    parentId: "child",
    footprint: rectangle([1200, 200, 2000, 800]),
  };
  domain.numerical.target = target;
  domain.world.fields.push({ ...domain.world.fields[0], id: "target", areaId: "child" });
  expect(regionalResolution(domain, "nested", "standard").cellSpan).toBeLessThan(
    resolution.cellSpan
  );
  expect(domain.numerical.parent.channels.stock).toEqual(source.channels.stock);
});
