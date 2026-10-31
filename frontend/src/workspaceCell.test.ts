import { expect, it } from "vitest";
import { generationSnapshot } from "@atlas/generation";
import { constructedWorld } from "./constructedWorldFixture";
import { registerWorldSnapshot, fixtureWorkspace } from "./testSupport/workspaceFixture";
import { workspaceCell } from "./workspaceCell";
import { refinementFixture } from "./testSupport/regionalRefinementFixture";

it("reads every published channel at the stored cell and leaves the catalog unchanged", async () => {
  const f = constructedWorld(),
    snapshot = generationSnapshot(f.result, f.input, crypto.randomUUID());
  registerWorldSnapshot(snapshot);
  const current = await fixtureWorkspace(snapshot.world.id),
    before = await current.catalog.readEditor(snapshot.world.id),
    result = await workspaceCell(
      current,
      snapshot.world.id,
      snapshot.scope.areaId,
      { x: 1700, y: 300, z: 0 },
      current.working.cache
    ),
    values = result.cells.flatMap((cell) => cell.values);
  expect(values.find((value) => value.channel === "elevation")).toMatchObject({
    value: 100,
    unit: "metre",
  });
  expect(new Set(values.map((value) => value.channel))).toEqual(
    new Set(["elevation", "temperature", "water", "impactExcavation"])
  );
  expect(values.every((value) => value.fieldId && value.resourceId)).toBe(true);
  expect(await current.catalog.readEditor(snapshot.world.id)).toEqual(before);
});

it("inspects an independent child's own captured cells without including its parent fields", async () => {
  const f = await refinementFixture(),
    world = await f.workspace.catalog.readEditor(f.id),
    result = await workspaceCell(
      f.workspace,
      f.id,
      f.child,
      { x: 1700, y: 300, z: 0 },
      f.workspace.working.cache
    ),
    fields = new Set(
      world.fields.filter((field) => field.areaId === f.child).map((field) => field.id)
    );
  expect(result.cells.length).toBeGreaterThan(0);
  expect(
    result.cells.flatMap((cell) => cell.values).every((value) => fields.has(value.fieldId))
  ).toBe(true);
  expect(result.areaId).toBe(f.child);
});
