import { expect, it } from "vitest";
import { canonryMagicPresets } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { atlasPhysicalProfile } from "./atlasProfile";
import { createField } from "./field";
import { createMesh } from "./mesh";
import { initializeMagic } from "./magicState";
import { locateMagicSources } from "./magicSources";
import { propagateMagic } from "./magicPropagation";

function fixture() {
  const state = landscape(),
    map = createField(createMesh(32, 0));
  map.mesh.neighbors.fill(-1);
  map.Temperature.fill(330);
  state.domain.world.magicSystems = canonryMagicPresets();
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: new Int32Array(state.surface.active.length),
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 1, minimumSize: 1, featureSamples: 2 },
  };
  initializeMagic(state);
  return { state, map, field: state.physical.magic!.fields[1] };
}

it("keeps local Aurora intensity independent of cell area on identical unconnected terrain", () => {
  const intensities: number[] = [];
  for (const cellAreaKm2 of [800, 200, 50]) {
    const { state, map, field } = fixture();
    map.mesh.areas.fill(cellAreaKm2 * 1e6);
    locateMagicSources(state, field, 73);
    propagateMagic(state, field, 73, 1);
    expect(field.source[0]).toBe(30);
    intensities.push(field.intensity[0]);
    expect(field.intensity.every((value) => value === intensities.at(-1))).toBe(true);
    expect(field.retained.every((value) => value === 0)).toBe(true);
  }
  expect(new Set(intensities).size).toBe(1);
  expect(intensities[0]).toBeLessThan(510);
});

function drainage(steps: number, area: number, ice = 0) {
  const result = fixture(),
    { state, map, field } = result;
  map.mesh.areas.fill(area / steps);
  map.mesh.edgeLength.fill(40_000 / steps);
  map.IceThickness.fill(ice);
  field.source.fill(0);
  for (let i = 0; i < steps; i++) {
    map.Temperature[i] = 300 - i;
    field.source[i] = 30;
    if (i < steps - 1) map.mesh.neighbors[i * map.mesh.stride] = i + 1;
    if (i > 0) map.mesh.neighbors[i * map.mesh.stride + 1] = i - 1;
  }
  propagateMagic(state, field, 73, 1);
  return { ...result, terminal: field.intensity[steps - 1] };
}

it("converges on the same cold sink while retaining concentration from its physical catchment", () => {
  const coarse = drainage(16, 400_000_000),
    finer = drainage(32, 400_000_000);
  expect(Math.abs(coarse.terminal - finer.terminal)).toBeLessThanOrEqual(3);
  expect(coarse.terminal).toBeGreaterThan(coarse.field.intensity[0]);
  expect(drainage(32, 800_000_000).terminal).toBeGreaterThan(finer.terminal);
  const captured = drainage(32, 400_000_000, 400);
  expect(captured.field.retained.some((value) => value > 0)).toBe(true);
  expect(captured.terminal).toBeLessThan(finer.terminal + 100);
});

it("uses the configured reference area for arriving charge without rescaling local input", () => {
  const { state, field } = drainage(16, 400_000_000);
  const before = field.intensity.slice();
  field.definition.parameters.accumulationArea *= 2;
  propagateMagic(state, field, 73, 1);
  expect(field.intensity[0]).toBe(before[0]);
  expect(field.intensity[15]).toBeLessThan(before[15]);
});
