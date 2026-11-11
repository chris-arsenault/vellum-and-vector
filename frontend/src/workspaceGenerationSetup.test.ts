import { expect, it } from "vitest";
import { refinementFixture } from "./testSupport/regionalRefinementFixture";
import { generationSource } from "./workspaceGeneration";
import { workspaceGenerationSetup } from "./workspaceGenerationSetup";

it("regional preflight opens pinned field resources before checking inherited requirements", async () => {
  const f = await refinementFixture(),
    source = await generationSource(f.workspace.catalog, f.id, f.child);
  expect(Object.keys(source.numerical)).toHaveLength(0);
  expect(
    source.world.fields.some((field) => field.input && field.channels?.includes("Elevation"))
  ).toBe(true);
  const setup = await workspaceGenerationSetup(
    f.workspace,
    f.id,
    {
      areaId: f.child,
      seed: 73,
      quality: "draft",
      domains: ["physical"],
    },
    f.workspace.working.cache
  );
  expect(
    setup.diagnostics.filter((diagnostic) => diagnostic.message.includes("field:Elevation"))
  ).toEqual([]);
  expect(setup.input.configuration).toBeDefined();
});
