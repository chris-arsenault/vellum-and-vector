import { expect } from "vitest";
import { regionRefinementInput, refinedRegionArea, spatial } from "@atlas/domain";
import { generationSnapshot } from "@atlas/generation";
import { suppliedIsland } from "./regionalRefinementFixture";
import { fixtureState, fixtureWorkspace, registerWorldSnapshot } from "./workspaceFixture";
import { executeWorkspaceCommand } from "../workspaceCommands";

/** A supplied default-sized world; selection, capture and refinement use real workspace paths. */
export async function normalizedRegionFixture() {
  const supplied = suppliedIsland(4_000_000, 3_000_000, Math.sqrt(200e6)),
    parent = generationSnapshot(supplied.result, supplied.input, crypto.randomUUID()),
    root = parent.scope.areaId,
    id = parent.world.id;
  parent.world.features.country = {
    id: "country",
    areaId: root,
    layerId: "sovereignty",
    kind: "sovereignty",
    name: "Supplied island country",
    geometry: spatial.buffer({ type: "Point", coordinates: [2_000_000, 1_500_000] }, 1_150_000)!,
    attributes: {},
    detail: {},
    relations: [],
    causes: [],
    state: "generated",
    actor: "generator",
    protected: false,
    generationId: null,
  };
  registerWorldSnapshot(parent);
  const workspace = await fixtureWorkspace(id),
    scope = { worldId: id, areaId: root, spaceId: parent.scope.spaceId },
    started = performance.now(),
    choices = await workspace.catalog.regionChoices({
      scope,
      sourceAreaId: root,
      parentId: null,
      editingId: null,
      cuts: [],
      position: { x: 2_200_000, y: 1_700_000, z: 0 },
      viewport: [0, 0, 4_000_000, 3_000_000],
    }),
    regionId = crypto.randomUUID();
  expect(choices.candidates.length).toBeGreaterThan(1);
  expect(spatial.area(choices.candidates[0].footprint) / 1e6).toBeGreaterThan(150_000);
  expect(spatial.area(choices.candidates[0].footprint) / 1e6).toBeLessThan(700_000);
  let world = await workspace.catalog.readEditor(id);
  const command = async (kind: string, data: Record<string, unknown>) => {
    await executeWorkspaceCommand(
      workspace.catalog,
      workspace.resources,
      {
        scope,
        preview: false,
        command: { operationId: crypto.randomUUID(), expectedVersion: world.version, kind, data },
      },
      workspace.working.cache
    );
    world = await workspace.catalog.readEditor(id);
  };
  await command("putView", {
    id: regionId,
    name: "Typical Standard region",
    areaId: root,
    layers: [],
    region: { parentId: null, footprint: choices.candidates[0].footprint },
  });
  await command("createArea", regionRefinementInput(world, regionId));
  const child = refinedRegionArea(world, regionId)!.id;
  expect(world.areas[child].map?.refinementLevel).toBe(1);
  return {
    id,
    root,
    child,
    workspace,
    parent,
    current: () => fixtureState(id).snapshot,
    creationMs: performance.now() - started,
  };
}
