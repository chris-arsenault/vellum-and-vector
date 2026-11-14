import { expect, it } from "vitest";
import { createField, type PhysicalField } from "./field";
import { deformTectonicBonds } from "./tectonicFracture";
import {
  indexTectonicBonds,
  type TectonicBond,
  type TectonicSite,
  type TectonicState,
} from "./tectonicState";
import { createWorldMesh } from "./worldMesh";

const field = () => createField(createWorldMesh([0, 0, 4_000_000, 4_000_000], 64, 0));
function site(
  map: PhysicalField,
  id: number,
  plate: number,
  x: number,
  assembly: number
): TectonicSite {
  const [west, south] = map.mesh.bounds,
    [ox, oy] = map.mesh.origin,
    at = west - ox + 2_000_000 + x,
    y = south - oy + 2_000_000;
  return {
    id,
    plate,
    block: plate,
    x: at,
    y,
    originX: at,
    originY: y,
    priority: 0,
    assembly,
    oceanPlate: 0,
    motionX: 0,
    motionY: 0,
    driveX: 0,
    driveY: 0,
    mass: 1,
    area: 250_000_000_000,
    compliance: 0,
    pullX: 0,
    pullY: 0,
  };
}
const bondOf = (a: number, b: number, part: Partial<TectonicBond> = {}): TectonicBond => ({
  a,
  b,
  strength: 1,
  extension: 0,
  shortening: 0,
  broken: false,
  active: true,
  ...part,
});
function stateOf(map: PhysicalField, sites: TectonicSite[], bonds: TectonicBond[], rate = 1) {
  const ids = [...new Set(sites.map((s) => s.plate))];
  const state = {
    sites,
    bonds,
    plates: ids.map((id) => {
      const members = sites.filter((s) => s.plate === id);
      return {
        id,
        x: members.reduce((sum, s) => sum + s.x, 0) / members.length,
        y: members[0].y,
        motionX: members[0].motionX,
        motionY: members[0].motionY,
        spin: 0,
      };
    }),
    nextPlateId: 10,
    elapsedMyr: 0,
    splits: 0,
    welds: 0,
    sunk: 0,
    rate,
    seed: 1,
    bondLookup: new Int32Array(0),
    transitions: [],
  } as TectonicState;
  indexTectonicBonds(state);
  return state;
}

it("sinks an ocean province that runs into a continent and renews it behind its plate", () => {
  const map = field(),
    trailing = site(map, 1, 1, -800_000, 0),
    leading = site(map, 2, 1, -100_000, 0),
    continent = site(map, 3, 2, 100_000, 1);
  trailing.motionX = leading.motionX = 0.5;
  continent.motionX = 0;
  const state = stateOf(map, [trailing, leading, continent], [bondOf(0, 1), bondOf(1, 2)]);
  const before = leading.x;
  deformTectonicBonds(map, state, 0.001);
  expect(state.sunk).toBe(1);
  expect(leading.x).toBeLessThan(before);
  expect(leading.plate).toBe(1);
});

it("leaves an ocean alone until it reaches what it sinks beneath", () => {
  const map = field(),
    trailing = site(map, 1, 1, -1_600_000, 0),
    leading = site(map, 2, 1, -900_000, 0),
    continent = site(map, 3, 2, 900_000, 1);
  leading.motionX = trailing.motionX = 0.5;
  const state = stateOf(map, [trailing, leading, continent], [bondOf(0, 1), bondOf(1, 2)]);
  deformTectonicBonds(map, state, 0.001);
  expect(state.sunk).toBe(0);
});

it("locks continents together once they have closed far enough, however fast", () => {
  const map = field(),
    left = site(map, 1, 1, -200_000, 1),
    right = site(map, 2, 2, 200_000, 2);
  left.motionX = 0.5;
  right.motionX = -0.5;
  const state = stateOf(map, [left, right], [bondOf(0, 1, { shortening: 0.6 })]);
  deformTectonicBonds(map, state, 0.001);
  expect(state.welds).toBe(1);
  expect(left.plate).toBe(right.plate);
  expect(state.bonds[0].suture).toBe(true);
  expect(state.bonds[0].strength).toBeLessThan(1);
});

it("tears a welded plate along its seam when its blocks are pulled apart", () => {
  const map = field(),
    left = site(map, 1, 1, -200_000, 1),
    right = site(map, 2, 1, 200_000, 2);
  right.block = 2;
  left.pullX = -0.5;
  right.pullX = 0.5;
  const state = stateOf(
    map,
    [left, right],
    [bondOf(0, 1, { suture: true, strength: 0.25 })],
    95_000
  );
  deformTectonicBonds(map, state, 10);
  expect(state.splits).toBe(1);
  expect(left.plate).not.toBe(right.plate);
  expect(right.driveX).toBeGreaterThan(0);
});

it("tears welded continents apart in time with nothing pulling on them", () => {
  const map = field(),
    left = site(map, 1, 1, -200_000, 1),
    right = site(map, 2, 1, 200_000, 2);
  right.block = 2;
  const state = stateOf(
    map,
    [left, right],
    [bondOf(0, 1, { suture: true, strength: 0.25 })],
    95_000
  );
  deformTectonicBonds(map, state, 1);
  expect(state.splits).toBe(0);
  for (let n = 0; n < 30 && state.splits === 0; n++) deformTectonicBonds(map, state, 1);
  expect(state.splits).toBe(1);
  expect(left.driveX).toBeLessThan(0);
  expect(right.driveX).toBeGreaterThan(0);
});
/** Myr until a two-province continent tears, with its one bond at this strength and nothing else on it. */
function myrToTear(bond: Partial<TectonicBond>, area = 250_000_000_000) {
  const map = field(),
    left = site(map, 1, 1, -200_000, 1),
    right = site(map, 2, 1, 200_000, 1);
  left.area = right.area = area;
  const state = stateOf(map, [left, right], [bondOf(0, 1, bond)], 95_000);
  for (let myr = 1; myr <= 400; myr++) {
    deformTectonicBonds(map, state, 1);
    if (state.splits) return myr;
  }
  return Infinity;
}
it("tears a continent that was never welded, later than an old seam", () => {
  const intact = myrToTear({ strength: 4 }),
    seam = myrToTear({ strength: 0.25, suture: true });
  expect(intact).toBeLessThan(Infinity);
  expect(seam).toBeLessThan(intact);
});
it("tears a wide continent sooner than a small one", () => {
  expect(myrToTear({ strength: 4 }, 4e12)).toBeLessThan(myrToTear({ strength: 4 }, 1e11));
});
it("rifts a continent over a plume sooner than one with none under it", () => {
  const tear = (plume: boolean) => {
    const map = field(),
      left = site(map, 1, 1, -200_000, 1),
      right = site(map, 2, 1, 200_000, 1);
    if (plume)
      map.events.push({
        id: "plume:1",
        kind: "plume",
        x: (left.x + right.x) / 2,
        y: left.y,
        radius: 110_000,
        epoch: 0,
        strength: 1000,
      });
    const state = stateOf(map, [left, right], [bondOf(0, 1, { strength: 4 })], 95_000);
    for (let myr = 1; myr <= 400; myr++) {
      deformTectonicBonds(map, state, 1);
      if (state.splits) return myr;
    }
    return Infinity;
  };
  expect(tear(true)).toBeLessThan(tear(false));
});
it("tears ocean away from a continent's margin under pull, giving the plate a new edge", () => {
  const map = field(),
    land = site(map, 1, 1, -200_000, 1),
    ocean = site(map, 2, 1, 200_000, 0);
  ocean.pullX = 0.5;
  const state = stateOf(map, [land, ocean], [bondOf(0, 1)], 95_000);
  deformTectonicBonds(map, state, 10);
  expect(state.splits).toBe(1);
  expect(land.plate).not.toBe(ocean.plate);
});

it("lets ocean sinking at a continent's margin tear the continent, not only an old seam", () => {
  const tearUnderPull = (strength: number) => {
    const map = field(),
      margin = site(map, 1, 1, 200_000, 1),
      interior = site(map, 2, 1, -200_000, 1);
    margin.pullX = 0.5;
    const state = stateOf(map, [interior, margin], [bondOf(0, 1, { strength })], 95_000);
    for (let myr = 1; myr <= 200; myr++) {
      deformTectonicBonds(map, state, 1);
      if (state.splits) return myr;
    }
    return Infinity;
  };
  expect(tearUnderPull(4)).toBeLessThan(Infinity);
  expect(tearUnderPull(0.25)).toBeLessThan(tearUnderPull(4));
});
