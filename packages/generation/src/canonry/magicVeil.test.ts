import { expect, it } from "vitest";
import { canonryConfluencePresets, canonryMagicPresets } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { initializeMagic } from "./magicState";
import { locateMagicSources } from "./magicSources";
import { propagateMagic } from "./magicPropagation";
import { magicLivingFeedback } from "./magicFeedback";
import { veilWrites } from "./magicVeil";
import { units } from "./math";

/** A 200 km square of land at 10 km cells where Fire and Aurora can be laid against each other. */
function scenario() {
  const state = landscape(),
    map = createField(
      createAdaptiveWorldMesh(
        [-100_000, -100_000, 100_000, 100_000],
        { maximumSize: 10_000, minimumSize: 10_000, refine: () => true },
        0
      )
    );
  state.domain.world.magicSystems = canonryMagicPresets();
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: new Int32Array(state.surface.active.length),
    fixed: [],
    inherited: false,
    sampling: { maximumSize: map.mesh.spacing, minimumSize: map.mesh.spacing, featureSamples: 2 },
  };
  map.Temperature.fill(300);
  map.WaterKindCodes.fill(0);
  map.IceThickness.fill(0);
  map.BroadleafCover.fill(0.5);
  map.TreeCover.fill(0.5);
  map.GrassCover.fill(0.3);
  initializeMagic(state);
  const fields = state.physical.magic!.fields,
    field = (id: string) => fields.find((f) => f.definition.id === id)!,
    veil = field("veil");
  const evaluate = () => {
    locateMagicSources(state, veil, 1, 0);
    propagateMagic(state, veil, 1, 1);
    magicLivingFeedback(state);
  };
  const cells = (test: (x: number, y: number) => boolean) =>
    Array.from(map.mesh.x, (x, i) => i).filter((i) => test(map.mesh.x[i], map.mesh.y[i]));
  /** Fire west of the line and Aurora east of it, both full, overlapping in a thin band. */
  const front = (x = 0) => {
    for (let i = 0; i < map.mesh.count; i++) {
      field("fire").intensity[i] = map.mesh.x[i] < x + 5000 ? 1000 : 0;
      field("aurora").intensity[i] = map.mesh.x[i] > x - 5000 ? 1000 : 0;
    }
    return cells((cx) => Math.abs(cx - x) < 5000);
  };
  return { state, map, field, veil, evaluate, cells, front };
}

it("has no Veil in a world with one other system, and tears along a Fire and Aurora front", () => {
  const s = scenario();
  s.field("fire").intensity.fill(1000);
  s.evaluate();
  expect(Math.max(...s.veil.intensity)).toBe(0);
  const band = s.front();
  s.evaluate();
  // The band's edges tear, where the gap between the two turns across a cell's edges.
  const torn = s.cells(
    (x, y) => s.veil.intensity[s.cells((cx, cy) => cx === x && cy === y)[0]] > 0
  );
  expect(torn.length).toBeGreaterThan(0);
  expect(torn.every((i) => band.includes(i) && s.veil.intensity[i] === 1000)).toBe(true);
  expect(torn.every((i) => s.map.Tearing[i] === 1)).toBe(true);
  const away = s.cells((x) => Math.abs(x) > 25_000);
  expect(away.every((i) => s.veil.intensity[i] === 0)).toBe(true);
  // A tear that has just formed is wholly wild; one that holds its place is not.
  expect(torn.every((i) => s.veil.wild[i] === 1)).toBe(true);
  s.evaluate();
  expect(torn.every((i) => s.veil.wild[i] === 0)).toBe(true);
});

it("tears more where a meeting's coverage holds the cell, and relaxes where verdure knits the ground", () => {
  const s = scenario(),
    i = s.cells((x, y) => Math.abs(x) < 5000 && Math.abs(y) < 5000)[0],
    war = canonryConfluencePresets()[0];
  const coverage = new Float64Array(s.map.mesh.count);
  coverage[i] = 0.3;
  s.state.physical!.magic!.confluences.states.war = {
    definition: war,
    members: new Uint8Array(s.map.mesh.count),
    coverage,
  };
  s.evaluate();
  expect(s.veil.intensity[i]).toBe(714);
  s.map.Verdure[i] = 1;
  s.evaluate();
  expect(s.veil.intensity[i]).toBe(29);
});

it("moves a wild zone's ground within the bound and shuffles its cover, and leaves a still tear alone", () => {
  const s = scenario();
  s.front();
  s.evaluate();
  const i = s.veil.intensity.findIndex((v) => v > 0),
    ground = s.map.BedrockElevation[i],
    trees = s.map.TreeCover[i],
    far = s.cells((x) => x > 50_000)[0],
    farGround = s.map.BedrockElevation[far];
  veilWrites(s.state, 0);
  expect(s.map.BedrockElevation[i]).not.toBe(ground);
  expect(Math.abs(s.map.BedrockElevation[i] - ground)).toBeLessThanOrEqual(units(20));
  expect(s.map.TreeCover[i]).not.toBe(trees);
  expect(s.map.TreeCover[i]).toBeCloseTo(s.map.BroadleafCover[i] + s.map.ConiferCover[i], 9);
  expect(s.map.BedrockElevation[far]).toBe(farGround);
  // The second epoch: the tear holds, so nothing moves.
  s.evaluate();
  const settled = s.map.BedrockElevation[i];
  veilWrites(s.state, 1);
  expect(s.map.BedrockElevation[i]).toBe(settled);
});

/** Fire everywhere and Aurora in two far blobs: their edges are stable tears a world apart. */
function twoTears(s: ReturnType<typeof scenario>) {
  s.field("fire").intensity.fill(1000);
  for (let i = 0; i < s.map.mesh.count; i++)
    s.field("aurora").intensity[i] = Math.abs(s.map.mesh.x[i]) > 60_000 ? 1000 : 0;
  s.veil.definition.parameters.doorDistance = 100_000;
  s.evaluate();
  s.evaluate();
}

it("pairs stable tears far apart into doors with a pool, a chill and a ring", () => {
  const s = scenario();
  twoTears(s);
  expect(s.veil.doors.length).toBeGreaterThan(0);
  expect(s.veil.doors.length).toBeLessThanOrEqual(6);
  for (const door of s.veil.doors) {
    const span = Math.hypot(
      s.map.mesh.x[door.a] - s.map.mesh.x[door.b],
      s.map.mesh.y[door.a] - s.map.mesh.y[door.b]
    );
    expect(span).toBeGreaterThanOrEqual(100_000);
    expect(s.veil.originSources.door[door.a]).toBeGreaterThanOrEqual(400);
  }
  const { a } = s.veil.doors[0];
  veilWrites(s.state, 0);
  expect(s.map.Temperature[a]).toBe(270);
  expect(s.veil.subsided[a]).toBe(3);
  const ring = Array.from(
    { length: s.map.mesh.degree[a] },
    (_, e) => s.map.mesh.neighbors[a * s.map.mesh.stride + e]
  ).filter((j) => j >= 0);
  expect(ring.every((j) => s.map.GrassCover[j] >= 0.3)).toBe(true);
  // The pool is sunk once.
  veilWrites(s.state, 1);
  expect(s.veil.subsided[a]).toBe(3);
});

it("closes a door under Aurora's charge, ruptures it under Fire, seals it under a ward, and salt holds a tear", () => {
  const s = scenario();
  twoTears(s);
  const { a, b } = s.veil.doors[0];
  s.field("aurora").stored[a] = 400;
  s.evaluate();
  expect(s.veil.doors.some((door) => door.a === a || door.b === a)).toBe(false);
  s.field("aurora").stored[a] = 0;
  s.map.Warding[b] = 1;
  s.evaluate();
  expect(s.veil.doors.some((door) => door.a === b || door.b === b)).toBe(false);
  s.map.Warding[b] = 0;
  s.field("fire").source[a] = 500;
  s.evaluate();
  expect(s.veil.doors.some((door) => door.a === a || door.b === a)).toBe(false);
  expect(s.veil.wild[a]).toBe(1);
  // Salted ground holds a tear after the strain that made it is gone.
  s.field("fire").source[a] = 0;
  s.evaluate();
  s.map.Salting[a] = 1;
  s.field("aurora").intensity.fill(0);
  s.evaluate();
  expect(s.veil.intensity[a]).toBe(1000);
  s.map.Salting[a] = 0;
  s.evaluate();
  expect(s.veil.intensity[a]).toBe(0);
});

it("changes nothing when Veil is disabled", () => {
  const s = scenario();
  s.veil.definition.enabled = false;
  const band = s.front(),
    ground = s.map.BedrockElevation[band[0]];
  s.evaluate();
  veilWrites(s.state, 0);
  expect(Math.max(...s.veil.intensity)).toBe(0);
  expect(s.map.Tearing.some(Boolean)).toBe(false);
  expect(s.map.BedrockElevation[band[0]]).toBe(ground);
});
