import { expect } from "vitest";
import {
  canonicalPosition,
  fieldInterpolator,
  gridPosition,
  rectangle,
  regionRefinementInput,
  refinedRegionArea,
  spatial,
  type DomainSnapshot,
  type Grid,
} from "@atlas/domain";
import type { CompletedBoundary } from "@atlas/generation";
import { fixtureState, fixtureWorkspace, registerWorldSnapshot } from "./workspaceFixture";
import { executeWorkspaceCommand } from "../workspaceCommands";

/** Reuse the shared completed generation; capture uses the real workspace command path. */
export async function generatedMagicRegion(parent: DomainSnapshot, surface: Grid) {
  registerWorldSnapshot(parent);
  const workspace = await fixtureWorkspace(parent.world.id);
  return captureRegion(parent, workspace, parent.scope.areaId, surface, [220000, 160000]);
}
export async function nestedMagicRegion(
  parent: DomainSnapshot,
  workspace: Awaited<ReturnType<typeof fixtureWorkspace>>,
  surface: Grid
) {
  return captureRegion(parent, workspace, parent.scope.areaId, surface, [40000, 30000]);
}
async function captureRegion(
  parent: DomainSnapshot,
  workspace: Awaited<ReturnType<typeof fixtureWorkspace>>,
  root: string,
  surface: Grid,
  [halfWidth, halfHeight]: [number, number]
) {
  const id = parent.world.id,
    regionId = crypto.randomUUID(),
    scope = { worldId: id, areaId: root, spaceId: parent.scope.spaceId },
    center = magicCountry(surface),
    [w, s, e, n] = spatial.bounds(parent.world.areas[root].footprint),
    // Keep this workload's working frame inside its supplied source coverage.
    x = Math.max(w + halfWidth * 1.5, Math.min(e - halfWidth * 1.5, center.x)),
    y = Math.max(s + halfHeight * 1.7, Math.min(n - halfHeight * 1.7, center.y)),
    footprint = rectangle([x - halfWidth, y - halfHeight, x + halfWidth, y + halfHeight]);
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
    name: "Generated magical country",
    areaId: root,
    layers: [],
    region: { parentId: null, footprint },
  });
  await command("createArea", regionRefinementInput(world, regionId));
  const child = refinedRegionArea(world, regionId)!.id;
  return { id, root, child, workspace, parent, current: () => fixtureState(id).snapshot };
}

function magicCountry(surface: Grid) {
  const systems = ["fire", "aurora", "greenwood", "salt"].map(
    (id) => surface.channels[`magic:${id}:coverage`]
  );
  let best = -1,
    score = -1;
  for (let i = 0; i < surface.active.length; i++) {
    if (surface.channels.water.get(i) !== 0) continue;
    const present = systems.reduce((sum, values) => sum + (values?.get(i) ?? 0), 0);
    if (present > score) {
      score = present;
      best = i;
    }
  }
  expect(best).toBeGreaterThanOrEqual(0);
  expect(score).toBeGreaterThan(0);
  return gridPosition(surface, best);
}

export function assertDevelopedMagic(result: CompletedBoundary, source: DomainSnapshot) {
  const g = result.state.surface,
    stock = "magic:fire:stock:vein/held",
    captured = Object.values(source.numerical).find((field) => field.channels[stock])!;
  expect(captured).toBeDefined();
  const input = fieldInterpolator(captured, stock),
    inputArea = fieldInterpolator(
      { ...captured, channels: { measure: captured.measures } },
      "measure",
      true
    ),
    bounds = spatial.bounds(source.world.reference.domain);
  let changed = 0;
  for (let i = 0; i < g.active.length; i++) {
    const p = canonicalPosition(source.world.reference, gridPosition(g, i), bounds),
      before = input(p) / inputArea(p),
      after = g.channels[stock].get(i) / g.measures.get(i);
    if (Math.abs(after - before) > 1e-6) changed++;
  }
  expect(changed).toBeGreaterThan(0);
  expect(Object.keys(g.channels).some((name) => name.startsWith("magic:fire:coverage:"))).toBe(
    true
  );
  expect(result.state.history).toEqual([]);
  expect(result.state.domain.world.epochs).toEqual(source.world.epochs);
}
