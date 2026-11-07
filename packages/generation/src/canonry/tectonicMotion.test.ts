import { expect, it } from "vitest";
import { createField } from "./field";
import { plateTravel } from "./tectonicControls";
import { edgeAllowance, updatePlateMotion } from "./tectonicMotion";
import type { TectonicSite, TectonicState } from "./tectonicState";
import { createWorldMesh } from "./worldMesh";

it("travels furthest in the first epoch, whatever the epoch's strength, and not at all with none", () => {
  const profile = { PlateDriftPerEpoch: 1000, PlateDriftDecay: 0.5 };
  expect(plateTravel(profile, 0, 1000)).toBe(1000);
  expect(plateTravel(profile, 2, 100)).toBe(250);
  expect(plateTravel(profile, -1, 1000)).toBe(1000);
  expect(plateTravel(profile, 1, 0)).toBe(0);
});

it("keeps a plate's outward motion until its continent nears the edge, then stops it there", () => {
  const reach = 300_000;
  expect(edgeAllowance(900_000, reach)).toBe(1);
  expect(edgeAllowance(150_000, reach)).toBeCloseTo(0.5);
  expect(edgeAllowance(0, reach)).toBe(0);
  expect(edgeAllowance(-50_000, reach)).toBe(0);
});

/** How fast two head-on plates still close after their contact has pushed back for a step. */
function closingSpeed(firstAssembly: number, secondAssembly: number) {
  const map = createField(createWorldMesh([0, 0, 2_400_000, 2_400_000], 24, 0)),
    [west, south] = map.mesh.bounds,
    [originX, originY] = map.mesh.origin,
    middle = south - originY + 1_200_000,
    centre = west - originX + 1_200_000;
  const site = (id: number, x: number, assembly: number, driveX: number): TectonicSite => ({
    id,
    plate: id,
    x,
    y: middle,
    originX: x,
    originY: middle,
    priority: 0,
    assembly,
    oceanPlate: 0,
    motionX: driveX,
    motionY: 0,
    driveX,
    driveY: 0,
    mass: 1,
    area: 1,
    compliance: 0,
    block: id,
    pullX: 0,
    pullY: 0,
  });
  const sites = [
    site(1, centre - 200_000, firstAssembly, 0.4),
    site(2, centre + 200_000, secondAssembly, -0.4),
  ];
  const state = {
    sites,
    plates: sites.map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      motionX: s.motionX,
      motionY: 0,
      spin: 0,
    })),
    bonds: [{ a: 0, b: 1, strength: 1, extension: 0, shortening: 0, broken: true, active: true }],
  } as unknown as TectonicState;
  updatePlateMotion(map, state, 4);
  return state.plates[0].motionX - state.plates[1].motionX;
}

it("lets an ocean sink and pull its plate on, while two continents push back", () => {
  expect(closingSpeed(1, 0)).toBeGreaterThan(0.8);
  expect(closingSpeed(0, 0)).toBeGreaterThan(closingSpeed(1, 0));
  expect(closingSpeed(1, 2)).toBeLessThan(0.75);
});
