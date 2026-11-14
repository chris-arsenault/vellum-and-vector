import { expect, it, vi } from "vitest";
import { rectangle, spatial } from "@atlas/domain";
import { CatalogProjection } from "./catalogProjection";
import { fixture, record, scope, write } from "./catalogFixture";

it("projects an export page together and retains ordered pagination", async () => {
  const catalog = await fixture();
  await write(catalog, [record("a"), record("b"), record("c")]);
  const context = vi.spyOn(CatalogProjection.prototype, "context");
  try {
    const first = catalog.exportFeatures(scope.worldId, scope.areaId, null, 2);
    expect(first.features.map((feature) => feature.id)).toEqual(["a", "b"]);
    expect(first.features[1]).toMatchObject({
      properties: { name: "b", areaId: scope.areaId, spaceId: scope.spaceId },
    });
    expect(spatial.bounds(first.features[1].geometry!)).toEqual([10, 10, 100, 100]);
    expect(first.next).toBe("b");
    expect(context).toHaveBeenCalledTimes(1);
    const last = catalog.exportFeatures(scope.worldId, undefined, first.next, 2);
    expect(last.features.map((feature) => feature.id)).toEqual(["c"]);
    expect(last.next).toBeNull();
    expect(context).toHaveBeenCalledTimes(2);
    expect(catalog.exportFeatures(scope.worldId, undefined, "c", 2)).toEqual({
      features: [],
      next: null,
    });
    expect(context).toHaveBeenCalledTimes(2);
  } finally {
    context.mockRestore();
  }
});

it("resolves each selected feature's area when a page spans mapped areas", async () => {
  const catalog = await fixture(),
    root = (await catalog.readEditor(scope.worldId)).areas[scope.areaId],
    nested = record("b", rectangle([500, 500, 700, 700]));
  nested.scope = { ...scope, areaId: "child" };
  if (nested.data.kind === "feature") nested.data.value.areaId = "child";
  await write(catalog, [
    {
      scope: { ...scope, areaId: "child" },
      reference: { kind: "area", id: "child", revision: 0 },
      data: {
        kind: "area",
        value: {
          ...root,
          id: "child",
          parentId: scope.areaId,
          footprint: rectangle([400, 400, 900, 900]),
        },
      },
    },
    record("a"),
    nested,
  ]);
  const page = catalog.exportFeatures(scope.worldId, undefined, null, 10);
  expect(page.features.map((feature) => feature.properties.areaId)).toEqual([
    scope.areaId,
    "child",
  ]);
  expect(spatial.bounds(page.features[1].geometry!)).toEqual([500, 500, 700, 700]);
});
