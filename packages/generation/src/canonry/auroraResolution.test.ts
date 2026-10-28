import { expect, it } from "vitest";
import { canonryMagicPresets } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { atlasPhysicalProfile } from "./atlasProfile";
import { createField } from "./field";
import { createMesh, type PhysicalMesh } from "./mesh";
import { initializeMagic } from "./magicState";
import { locateMagicSources } from "./magicSources";
import { propagateMagic } from "./magicPropagation";
import { advanceStocks } from "./magicStocks";

/** The reference disk, with its adjacency removed and its cell area and edge length settable. */
interface Wiring {
  area?: number;
  edge?: number;
  links: Map<number, number[]>;
}
function wired(base: PhysicalMesh) {
  const wiring: Wiring = { links: new Map() },
    mesh: PhysicalMesh = Object.create(base);
  Object.defineProperties(mesh, {
    neighbor: { value: (cell: number, edge: number) => wiring.links.get(cell)?.[edge] ?? -1 },
    area: { value: (cell: number) => wiring.area ?? base.area(cell) },
    edgeLength: {
      value: (cell: number, edge: number) => wiring.edge ?? base.edgeLength(cell, edge),
    },
  });
  return { mesh, wiring };
}

function fixture() {
  const state = landscape(),
    { mesh, wiring } = wired(createMesh(32, 0)),
    map = createField(mesh),
    cells: number[] = [];
  for (let i = 0; i < mesh.count; i++) if (mesh.membership(i) === 1) cells.push(i);
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
  return { state, map, wiring, cells, field: state.physical.magic!.fields[1] };
}

it("keeps local Aurora intensity independent of cell area on identical unconnected terrain", () => {
  const intensities: number[] = [];
  for (const cellAreaKm2 of [800, 200, 50]) {
    const { state, map, wiring, cells, field } = fixture();
    wiring.area = cellAreaKm2 * 1e6;
    locateMagicSources(state, field, 73);
    propagateMagic(state, field, 73, 1);
    expect(field.source.get(cells[0])).toBe(30);
    intensities.push(field.intensity.get(cells[0]));
    expect(cells.every((i) => field.intensity.get(i) === intensities.at(-1))).toBe(true);
    expect(Array.from(field.retained).every((value) => value === 0)).toBe(true);
    expect(map.mesh.area(cells[0])).toBe(cellAreaKm2 * 1e6);
  }
  expect(new Set(intensities).size).toBe(1);
  expect(intensities[0]).toBeLessThan(510);
});

function drainage(steps: number, area: number, ice = 0) {
  const result = fixture(),
    { state, map, wiring, cells, field } = result;
  wiring.area = area / steps;
  wiring.edge = 40_000 / steps;
  map.IceThickness.fill(ice);
  field.source.fill(0);
  for (let i = 0; i < steps; i++) {
    map.Temperature.set(cells[i], 300 - i);
    field.source.set(cells[i], 30);
    const links: number[] = [];
    if (i < steps - 1) links[0] = cells[i + 1];
    if (i > 0) links[1] = cells[i - 1];
    wiring.links.set(
      cells[i],
      Array.from({ length: 2 }, (_, edge) => links[edge] ?? -1)
    );
  }
  propagateMagic(state, field, 73, 1);
  return { ...result, terminal: field.intensity.get(cells[steps - 1]) };
}

it("keeps a local ice reservoir's concentration independent of terrain cell area", () => {
  const intensities: number[] = [];
  for (const cellAreaKm2 of [800, 200, 50]) {
    const { state, map, wiring, cells, field } = fixture();
    wiring.area = cellAreaKm2 * 1e6;
    map.IceThickness.fill(300);
    const ice = field.stocks["field/ice"];
    for (let i = 0; i < ice.length; i++) ice.set(i, 100 * map.mesh.area(i));
    locateMagicSources(state, field, 73);
    propagateMagic(state, field, 73, 1);
    intensities.push(field.intensity.get(cells[0]));
  }
  expect(new Set(intensities).size).toBe(1);
});

it("keeps existing charge in its ice carrier without capturing it again as fresh fallout", () => {
  const { state, map, field } = fixture();
  map.IceThickness.fill(300);
  const ice = field.stocks["field/ice"];
  for (let i = 0; i < ice.length; i++) ice.set(i, 100 * map.mesh.area(i));
  const before = Array.from(ice);
  propagateMagic(state, field, 73, 1);
  expect(Array.from(field.intensity).some((value) => value > 0)).toBe(true);
  expect(Array.from(field.retained).every((value) => value === 0)).toBe(true);
  advanceStocks(state, field, 0);
  expect(Array.from(ice)).toEqual(before);
});

it("converges on the same cold sink while retaining concentration from its physical catchment", () => {
  const coarse = drainage(16, 400_000_000),
    finer = drainage(32, 400_000_000);
  expect(Math.abs(coarse.terminal - finer.terminal)).toBeLessThanOrEqual(3);
  expect(coarse.terminal).toBeGreaterThan(coarse.field.intensity.get(coarse.cells[0]));
  expect(drainage(32, 800_000_000).terminal).toBeGreaterThan(finer.terminal);
  const captured = drainage(32, 400_000_000, 400);
  expect(Array.from(captured.field.retained).some((value) => value > 0)).toBe(true);
  expect(captured.terminal).toBeLessThan(finer.terminal + 100);
});

it("uses the configured reference area for arriving charge without rescaling local input", () => {
  const { state, field, cells } = drainage(16, 400_000_000);
  const before = Array.from(field.intensity);
  field.definition.parameters.accumulationArea *= 2;
  propagateMagic(state, field, 73, 1);
  expect(field.intensity.get(cells[0])).toBe(before[cells[0]]);
  expect(field.intensity.get(cells[15])).toBeLessThan(before[cells[15]]);
});
