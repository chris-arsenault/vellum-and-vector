import { expect, it } from "vitest";
import { generateAtlas, prepareAtlasGeneration } from "@atlas/generation";
import { gridPosition, rectangle } from "@atlas/domain";
import { createWorld, session, worldScope } from "./atlasState";
import { commitCommand } from "./atlasCommands";
import { generationSnapshot } from "./generationJobs";

it("retains actual inherited impact history when its local generation feature is disabled", async () => {
  const world = createWorld({
    name: "Inherited impact geography",
    seed: 73,
    width: 3_000_000,
    height: 2_000_000,
  });
  world.epochs = [world.epochs[0]];
  world.magicSystems = [];
  const source = session(world.id).snapshot;
  const input = { areaId: source.scope.areaId, seed: 73, quality: "draft", domains: ["physical"] };
  const prepared = prepareAtlasGeneration(source, input);
  const parent = await generateAtlas(source, prepared.input);
  const history = parent.state.surface.channels.impactExcavation;
  const retainedHistory = history.slice();
  const strongest = history.reduce(
    (best, value, index) => (value > history[best] ? index : best),
    0
  );
  expect(history[strongest]).toBeGreaterThan(0);
  const position = gridPosition(parent.state.surface, strongest);
  const snapshot = generationSnapshot(parent, prepared.input, crypto.randomUUID());
  session(world.id).snapshot = snapshot;
  const x = Math.max(0, Math.min(2_800_000, position.x - 100_000));
  const y = Math.max(0, Math.min(1_800_000, position.y - 100_000));
  const created = commitCommand(world.id, {
    operationId: crypto.randomUUID(),
    expectedVersion: snapshot.world.version,
    kind: "createArea",
    data: {
      parentId: input.areaId,
      name: "Inherited crater",
      profile: "region",
      footprint: rectangle([x, y, x + 200_000, y + 200_000]),
      frame: { origin: { x, y, z: 0 }, rotation: 0, metresPerUnit: 1, floor: null },
      approach: "manual",
      traits: [],
    },
  }).candidate;
  const child = Object.values(created.areas).find((area) => area.parentId === input.areaId)!;
  const inherited = { ...session(world.id).snapshot, scope: worldScope(created, child.id) };
  const request = prepareAtlasGeneration(inherited, {
    ...input,
    areaId: child.id,
    features: { "physical.impacts": { enabled: false } },
  });
  expect(request.diagnostics).toEqual([]);
  let observed = false;
  const result = await generateAtlas(inherited, request.input, {
    saveBoundary: async (boundary) => {
      if (boundary.kind !== "final") return;
      observed = true;
      expect(boundary.state.physical!.map.ImpactExcavation.some((value) => value > 0)).toBe(true);
    },
  });
  expect(observed).toBe(true);
  expect(result.state.domain.world.areas[child.id].boundary).toEqual(child.boundary);
  expect(result.state.domain.world.epochs).toEqual(snapshot.world.epochs);
  expect(parent.state.surface.channels.impactExcavation).toEqual(retainedHistory);
}, 120000);
