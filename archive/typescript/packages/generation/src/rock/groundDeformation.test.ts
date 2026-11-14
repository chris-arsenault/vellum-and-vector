import { expect, it } from "vitest";
import { createTestField } from "./groundTestFixture";
import { createField } from "../world/field";
import { groundFixture } from "./groundStorage";
import { shiftBedrock } from "../world/landmarkGeometry";
import { createWorldMesh } from "../world/worldMesh";
import { units } from "../world/math";
import { workingValues, releaseWorking } from "../world/physicalNumerics";
import { displaceGroundField, shiftGroundField, supportGroundField } from "./groundDeformation";
import {
  deformGround,
  deformSlope,
  heldLayers,
  holdRock,
  releaseHeldRock,
} from "./groundTransport";
import { materialLayer, readLayer, setLayer } from "./rockColumn";
import { rockCatalogue as rocks } from "./rockCatalogue";
import { projectGround } from "./groundShares";

function supplied(actualScale = false) {
  const mesh = createWorldMesh([0, 0, 1000, 1000], 16, 0),
    map = actualScale ? groundFixture(createField(mesh)) : createTestField(mesh);
  for (let cell = 0; cell < map.mesh.count; cell++) {
    for (const column of ["land", "cut", "loose", "cutLoose"] as const)
      setLayer(
        map,
        cell,
        0,
        rocks.sandstone.code,
        units(10),
        {
          bedSlopeX: 0.1,
          bedSlopeY: 0.2,
          grainX: 700,
          formedMin: 2,
          formedMax: 4,
          deposited: 6,
          altered: 7,
        },
        column
      );
    map.GroundCutShare.set(cell, 0.25);
    map.BedrockElevation.set(cell, units(500));
    map.CrustSupportElevation.set(cell, units(400));
    projectGround(map, cell);
  }
  map.CompletedEpochCount = 9;
  return map;
}
const sample = (map: ReturnType<typeof supplied>) =>
  Array.from({ length: map.mesh.count }, (_, i) => i).find(
    (i) =>
      map.mesh.membership(i) === 1 &&
      Array.from({ length: map.mesh.degree(i) }, (_, edge) => map.mesh.neighbor(i, edge)).every(
        (j) => j >= 0
      )
  )!;

it("keeps zero and positive movement signed on inherited ground above the child map's scale", () => {
  for (const move of [displaceGroundField, shiftGroundField]) {
    const map = supplied(true),
      cell = sample(map),
      movement = workingValues(map, "float64", "inherited:movement", () => 0),
      before = map.Elevation.get(cell);
    move(map, movement, "test");
    expect(map.Elevation.get(cell)).toBe(before);
    movement.fill(units(20));
    move(map, movement, "test");
    expect(map.Elevation.get(cell)).toBe(before + units(20));
    releaseWorking(map, movement);
  }
  const map = supplied(true),
    cell = sample(map),
    before = map.Elevation.get(cell);
  expect(shiftBedrock(map, cell, 0)).toBe(0);
  expect(map.Elevation.get(cell)).toBe(before);
  expect(shiftBedrock(map, cell, units(100))).toBe(units(100));
  expect(map.Elevation.get(cell)).toBe(before + units(100));
});

it("bends every occupied retained bed with the actual displacement while translation preserves dip", () => {
  const map = supplied(),
    cell = sample(map),
    translation = workingValues(map, "float64", "translation", () => units(20));
  displaceGroundField(map, translation, "translation");
  expect(readLayer(map, cell, 0)).toMatchObject({ bedSlopeX: 0.1, bedSlopeY: 0.2, altered: 7 });
  const bending = workingValues(map, "float64", "bending", (cell) =>
    units(map.mesh.x(cell) * 0.05)
  );
  displaceGroundField(map, bending, "bending");
  for (const column of ["land", "cut", "loose", "cutLoose"] as const) {
    const bed = readLayer(map, cell, 0, column);
    expect(bed.bedSlopeX).toBeCloseTo(0.15);
    expect(bed.bedSlopeY).toBeCloseTo(0.2);
    expect(bed).toMatchObject({
      formedMin: 2,
      formedMax: 4,
      deposited: 6,
      altered: 9,
      grainX: 700,
    });
  }
  expect(map.BedrockElevation.get(cell)).toBeCloseTo(units(520 + map.mesh.x(cell) * 0.05));
  releaseWorking(map, translation, bending);
});

it("commits support bending and its bed dip as one operation", () => {
  const map = supplied(),
    cell = sample(map);
  map.CrustSupportInitialized = true;
  const target = workingValues(map, "float64", "support", (cell) =>
    units(410 - 0.03 * map.mesh.y(cell))
  );
  supportGroundField(map, target);
  expect(map.CrustSupportElevation.get(cell)).toBe(target.get(cell));
  expect(map.BedrockElevation.get(cell)).toBeCloseTo(units(510 - 0.03 * map.mesh.y(cell)));
  expect(readLayer(map, cell, 0).bedSlopeY).toBeCloseTo(0.17);
  releaseWorking(map, target);
});

it("responds to changed support from an imported reference without resetting its elevation", () => {
  const map = supplied(true),
    cell = sample(map),
    before = map.Elevation.get(cell),
    target = workingValues(map, "float64", "support:target", () => units(-100)),
    datum = workingValues(map, "float64", "support:datum", () => units(500));
  map.CrustSupportInitialized = true;
  map.SupportDatum = datum;
  supportGroundField(map, target);
  expect(map.Elevation.get(cell)).toBeCloseTo(before);
  // A new load depresses the inherited column; unloading then raises it again.
  target.fill(units(-120));
  supportGroundField(map, target);
  expect(map.Elevation.get(cell)).toBeCloseTo(before - units(20));
  target.fill(units(-90));
  supportGroundField(map, target);
  expect(map.Elevation.get(cell)).toBeCloseTo(before + units(10));
  releaseWorking(map, target, datum);
});

it("distinguishes raised standing rock from translation so later support can see the added load", () => {
  const map = supplied(),
    cell = sample(map),
    loadBefore = map.SurfaceRockLoad.get(cell),
    movement = workingValues(map, "float64", "standing-rise", () => units(20));
  shiftGroundField(map, movement, "reactivation");
  expect(map.SurfaceRockLoad.get(cell)).toBeGreaterThan(loadBefore);
  const retainedLoad = map.SurfaceRockLoad.get(cell);
  displaceGroundField(map, movement, "fault displacement");
  expect(map.SurfaceRockLoad.get(cell)).toBe(retainedLoad);
  expect(readLayer(map, cell, 0)).toMatchObject({ formedMin: 2, formedMax: 4, deposited: 6 });
  releaseWorking(map, movement);
});

it("carries signed bed planes through rotation and stretching independently of axial clast fabric", () => {
  expect(deformSlope(0.1, 0.2, [2, 0, 0, 1])).toEqual([0.05, 0.2]);
  expect(deformSlope(0.1, 0.2, [0, -1, 1, 0])).toEqual([-0.2, 0.1]);
  const map = supplied();
  deformGround(map, 0, [0, -1, 1, 0]);
  const held = holdRock(map);
  expect(heldLayers(held, 0)[0]).toMatchObject({
    bedSlopeX: -0.2,
    bedSlopeY: 0.1,
    deposited: 6,
    altered: 7,
    consolidation: materialLayer(rocks.sandstone.code, 1).consolidation,
  });
  expect(readLayer(map, 0, 0).grainX).toBeCloseTo(-700);
  releaseHeldRock(map, held);
});
