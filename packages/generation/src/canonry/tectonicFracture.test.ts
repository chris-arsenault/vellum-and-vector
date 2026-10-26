import { expect, it } from "vitest";
import { createField } from "./field";
import { createWorldMesh } from "./worldMesh";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { tectonicSites, plateOf, indexTectonicBonds } from "./tectonicState";
import { deformTectonicBonds } from "./tectonicFracture";
import { updatePlateMotion } from "./tectonicMotion";

function chain(extension: number) {
  const map = createField(createWorldMesh([0, 0, 2e6, 1e6], 1024, 0));
  tectonicSites(map, physicalContext(73, 0, atlasPhysicalProfile()));
  const state = map.tectonics!;
  state.sites = state.sites.slice(0, 3).map((site, i) => ({
    ...site,
    x: (i - 1) * 200_000,
    y: 0,
    plate: 1,
    assembly: 1,
    driveX: i * extension,
    driveY: 0,
    motionX: 0,
    motionY: 0,
    mass: 1,
    area: 1e10,
    compliance: 0,
  }));
  state.plates = [plateOf(map, state.sites, 1)];
  state.nextPlateId = 2;
  state.bonds = [0, 1].map((a) => ({
    a,
    b: a + 1,
    strength: 1,
    extension: 0,
    shortening: 0,
    broken: false,
    active: true,
  }));
  indexTectonicBonds(state);
  return { map, state };
}

it("splits only after accumulated extension disconnects the mechanical graph", () => {
  const { map, state } = chain(1);
  deformTectonicBonds(map, state, 1);
  expect(state.plates).toHaveLength(1);
  expect(state.sites.some((site) => site.compliance > 0)).toBe(true);
  deformTectonicBonds(map, state, 4);
  expect(state.plates).toHaveLength(3);
  expect(new Set(state.sites.map((site) => site.assembly))).toEqual(new Set([1]));
  expect(state.transitions[0].kind).toBe("split");
  updatePlateMotion(map, state, 10);
  expect(new Set(state.sites.map((site) => site.motionX)).size).toBe(3);
});

it("preserves a coherent block under translation and under insufficient extension", () => {
  for (const extension of [0, 0.001]) {
    const { map, state } = chain(extension);
    for (let i = 0; i < 30; i++) deformTectonicBonds(map, state, 4);
    expect(state.plates).toHaveLength(1);
    expect(state.splits).toBe(0);
  }
});

it("does not turn an isolated failed bond into a detached plate", () => {
  const { map, state } = chain(0);
  state.bonds[0].broken = true;
  state.bonds.push({ ...state.bonds[1], a: 0, b: 2 });
  deformTectonicBonds(map, state, 4);
  expect(state.plates).toHaveLength(1);
});

it("welds a slow compressed continental contact while retaining both material origins", () => {
  const { map, state } = chain(0);
  state.sites = state.sites.slice(0, 2);
  state.sites[1].plate = 2;
  state.sites[1].assembly = 2;
  state.sites[0].motionX = 0.02;
  state.sites[1].motionX = -0.02;
  state.plates = [plateOf(map, state.sites, 1), plateOf(map, state.sites, 2)];
  state.bonds = [{ ...state.bonds[0], shortening: 0.3, broken: true }];
  deformTectonicBonds(map, state, 4);
  expect(state.plates).toHaveLength(1);
  expect(state.welds).toBe(1);
  expect(new Set(state.sites.map((site) => site.assembly))).toEqual(new Set([1, 2]));
  deformTectonicBonds(map, state, 4);
  expect(state.plates).toHaveLength(1);
});
