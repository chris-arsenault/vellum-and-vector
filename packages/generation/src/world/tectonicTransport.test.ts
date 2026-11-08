import { expect, it } from "vitest";
import { createField } from "./field";
import { createWorldMesh } from "./worldMesh";
import type { TectonicSite } from "./tectonicState";
import { tectonicTransport } from "./tectonicTransport";
import { buildTransportPlan, releaseTransportPlan } from "./transportPlan";
import { deformSlope } from "../rock/groundTransform";

function site(id: number): TectonicSite {
  return {
    id,
    plate: id,
    x: 0,
    y: 0,
    originX: 0,
    originY: 0,
    priority: 0,
    assembly: id,
    oceanPlate: 0,
    motionX: 0,
    motionY: 0,
    driveX: 0,
    driveY: 0,
    mass: 1,
    area: 1,
    compliance: 0,
    block: id,
    pullX: 0,
    pullY: 0,
  };
}
/** Supplied independent material blocks; no tectonic evolution runs in these contracts. */
function blocks() {
  const map = createField(createWorldMesh([0, 0, 8000, 8000], 64, 0));
  map.tectonics = {
    sites: [site(1), site(2)],
    plates: [
      { id: 1, x: 0, y: 0, motionX: 0.4, motionY: 0.3, spin: 0 },
      { id: 2, x: 0, y: 0, motionX: -0.95, motionY: 0, spin: 0 },
    ],
    bonds: [],
    nextPlateId: 3,
    elapsedMyr: 0,
    splits: 0,
    welds: 0,
    sunk: 0,
    rate: 1,
    seed: 1,
    bondLookup: new Int32Array(),
    transitions: [],
  };
  for (let i = 0; i < map.mesh.count; i++) map.CrustProvinceIds.set(i, map.mesh.x(i) > 0 ? 2 : 1);
  return map;
}

it("keeps each translating block's beds untilted even beside independently closing material", () => {
  const map = blocks(),
    plan = buildTransportPlan(map, map.mesh.spacing * 1.5);
  try {
    for (let i = 0; i < map.mesh.count; i++) {
      const f = [
        plan.deformationXX.get(i),
        plan.deformationXY.get(i),
        plan.deformationYX.get(i),
        plan.deformationYY.get(i),
      ] as const;
      const slope = deformSlope(0.1, 0.2, f);
      expect(slope[0]).toBeCloseTo(0.1);
      expect(slope[1]).toBeCloseTo(0.2);
    }
  } finally {
    releaseTransportPlan(map, plan);
  }
});

it.each([0, 0.4])(
  "captures the same local affine motion as the moved source, with compliance %s",
  (compliance) => {
    const map = blocks(),
      source = map.mesh.cellAt(-300, 200),
      distance = 1000;
    map.CrustProvinceIds.set(source, 1);
    map.tectonics!.sites[0].compliance = compliance;
    map.tectonics!.plates[0].spin = 0.2 / distance;
    const { move, deformation: f } = tectonicTransport(map, distance)(source),
      x = map.mesh.x(source),
      y = map.mesh.y(source),
      origin = move(x, y),
      along = move(x + 100, y + 50);
    // Within one donor, the same represented rotation and ductile residual move its whole bed.
    expect(along[0] - origin[0]).toBeCloseTo(f[0] * 100 + f[1] * 50);
    expect(along[1] - origin[1]).toBeCloseTo(f[2] * 100 + f[3] * 50);
    if (compliance === 0) {
      const slope = deformSlope(0.1, 0.2, f);
      expect(slope[0]).toBeCloseTo(0.1 * Math.cos(0.2) - 0.2 * Math.sin(0.2));
      expect(slope[1]).toBeCloseTo(0.1 * Math.sin(0.2) + 0.2 * Math.cos(0.2));
    }
  }
);

it("retains the donor rotation in the plan after province and mechanical ownership change", () => {
  const map = blocks(),
    source = map.mesh.cellAt(-300, 200),
    distance = 1000;
  map.CrustProvinceIds.set(source, 1);
  map.tectonics!.plates[0].spin = 0.2 / distance;
  const plan = buildTransportPlan(map, distance);
  try {
    map.CrustProvinceIds.set(source, 2);
    map.tectonics!.plates[0].spin = -0.5;
    const slope = deformSlope(0.1, 0.2, [
      plan.deformationXX.get(source),
      plan.deformationXY.get(source),
      plan.deformationYX.get(source),
      plan.deformationYY.get(source),
    ]);
    expect(slope[0]).toBeCloseTo(0.1 * Math.cos(0.2) - 0.2 * Math.sin(0.2));
    expect(slope[1]).toBeCloseTo(0.1 * Math.sin(0.2) + 0.2 * Math.cos(0.2));
  } finally {
    releaseTransportPlan(map, plan);
  }
});
