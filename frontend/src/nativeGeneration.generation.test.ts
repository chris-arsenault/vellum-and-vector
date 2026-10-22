import { expect, it } from "vitest";
import { generateAtlas, prepareAtlasGeneration, type CompletedBoundary } from "@atlas/generation";
import {
  gridPosition,
  rectangle,
  sample,
  fieldInterpolator,
  adaptiveLeafAt,
  nearestFieldSample,
  type Grid,
  type DomainSnapshot,
} from "@atlas/domain";
import { createWorld, session, worldScope } from "./atlasState";
import { commitCommand } from "./atlasCommands";
import { generationSnapshot } from "./generationJobs";

function gridIndexAt(grid: Grid, x: number, y: number) {
  if (grid.mesh) return nearestFieldSample(grid.mesh, { x, y, z: 0 });
  if (grid.topology) return adaptiveLeafAt(grid.topology, x, y);
  return (
    Math.round(((y - grid.bounds[1]) / (grid.bounds[3] - grid.bounds[1])) * (grid.height - 1)) *
      grid.width +
    Math.round(((x - grid.bounds[0]) / (grid.bounds[2] - grid.bounds[0])) * (grid.width - 1))
  );
}

function publishParent(result: CompletedBoundary, input: Parameters<typeof generationSnapshot>[1]) {
  const snapshot = generationSnapshot(result, input, crypto.randomUUID());
  session(snapshot.world.id).snapshot = snapshot;
  return snapshot;
}

async function checkThermalFeedback(
  snapshot: DomainSnapshot,
  input: Parameters<typeof generationSnapshot>[1]
) {
  const magical = structuredClone(snapshot);
  magical.world.magic.push({
    id: crypto.randomUUID(),
    name: "Thermal source",
    source: { x: 2_000_000, y: 1_000_000, z: 0 },
    radius: 3_000_000,
    strength: 5,
    propagation: "radial",
    effect: "heat",
    decay: 0,
    storage: 0,
    dependsOn: null,
    startsAtEpoch: 0,
    spaceId: snapshot.scope.spaceId,
  });
  const result = await generateAtlas(magical, { ...input, domains: ["magic"] });
  const grid = result.state.surface,
    i = gridIndexAt(grid, 2_000_000, 1_000_000);
  expect(grid.channels.heat[i]).toBeGreaterThan(4);
  expect(grid.channels.temperature[i]).toBeGreaterThan(grid.channels.naturalTemperature[i] + 3);
  expect(grid.channels.elevation[i]).toBeCloseTo(
    sample(
      snapshot.numerical[Object.keys(snapshot.numerical)[0]],
      "elevation",
      gridPosition(grid, i)
    ),
    8
  );
  const parent = snapshot.numerical[Object.keys(snapshot.numerical)[0]];
  const before = fieldInterpolator(parent, "elevation"),
    after = fieldInterpolator(grid, "elevation");
  for (const [x, y] of [
    [1_234_567, 1_345_678],
    [2_123_456, 1_123_456],
  ]) {
    const position = { x, y, z: 0 };
    expect(after(position)).toBeCloseTo(before(position), 8);
  }
}

it("refines inherited Canonry terrain and retains authored geography and its fixed interface", async () => {
  const world = createWorld({
    name: "Native refinement",
    seed: 104729,
    width: 4_000_000,
    height: 2_000_000,
  });
  const root = Object.keys(world.areas)[0],
    input = { areaId: root, seed: world.seed, quality: "draft", domains: ["physical"] };
  const started = performance.now();
  const result = await generateAtlas(session(world.id).snapshot, input);
  expect(result.state.physical).toBeUndefined();
  expect(result.state.surface.channels.crustThickness.some((value) => value > 1000)).toBe(true);
  const snapshot = publishParent(result, input);
  await checkThermalFeedback(snapshot, input);
  const authored = commitCommand(world.id, {
    operationId: crypto.randomUUID(),
    expectedVersion: snapshot.world.version,
    kind: "putLandform",
    data: {
      areaId: root,
      name: "Protected promontory",
      center: { x: 11000, y: 11000, z: 0 },
      radius: 3000,
      height: 250,
    },
  }).candidate;
  const created = commitCommand(world.id, {
    operationId: crypto.randomUUID(),
    expectedVersion: authored.version,
    kind: "createArea",
    data: {
      parentId: root,
      name: "Refined coast",
      profile: "region",
      footprint: rectangle([1000, 1000, 21000, 21000]),
      frame: { origin: { x: 1000, y: 1000, z: 0 }, rotation: 0, metresPerUnit: 1, floor: null },
      approach: "manual",
      traits: [],
    },
  }).candidate;
  const area = Object.values(created.areas).find((area) => area.parentId === root)!;
  const inherited = { ...session(world.id).snapshot, scope: worldScope(created, area.id) };
  const prepared = prepareAtlasGeneration(inherited, { ...input, areaId: area.id });
  expect(prepared.diagnostics).toEqual([]);
  const refined = await generateAtlas(inherited, prepared.input);
  expect(refined.state.domain.world.areas[area.id].boundary).toEqual(area.boundary);
  expect(refined.state.domain.world.features).toMatchObject(snapshot.world.features);
  expect(refined.state.surface.channels.elevation.every(Number.isFinite)).toBe(true);
  expect(refined.state.surface.scope.footprint).not.toEqual(area.footprint);
  expect(refined.state.domain.fieldPatches).toEqual(inherited.fieldPatches);
  const middle = gridIndexAt(refined.state.surface, 11000, 11000);
  const position = gridPosition(refined.state.surface, middle),
    patch = inherited.fieldPatches[0];
  expect(refined.state.surface.channels.elevation[middle]).toBeCloseTo(
    sample(inherited.numerical[patch.fieldId], "elevation", position),
    8
  );
  console.log(
    `Canonry draft world, thermal feedback and regional refinement: ${Math.round(performance.now() - started)} ms.`
  );
}, 600000);
