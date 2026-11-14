import { expect, it } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { createWorldMesh } from "./worldMesh";
import { realizeFaults } from "./fractureRealization";
import { resolveSheetContacts } from "./fractureRealization";
import { joinGroundSheet } from "../rock/groundTransport";

it("resolves a supplied retained fault on the local ground without creating a tectonic event", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 64, 0));
  map.FractureConductance.fill(200);
  map.TectonicStrain.fill(800);
  realizeFaults(map, [
    {
      id: "retained-fault",
      coordinates: [
        [-300, 0],
        [300, 0],
      ],
      width: 40,
    },
  ]);
  expect(map.faults[0].id).toBe("retained-fault");
  expect(map.events).toHaveLength(0);
  expect(
    Array.from({ length: map.mesh.count }, (_, cell) => map.FractureConductance.get(cell)).some(
      (value) => value > 200
    )
  ).toBe(true);
});

it("resolves a supplied strained sheet contact without changing the standing rock", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    next = map.mesh.neighbor(5, 0);
  map.FractureConductance.fill(200);
  map.TectonicStrain.fill(800);
  joinGroundSheet(map, 5, 1, 1, 1, 0.2);
  joinGroundSheet(map, next, 1, 2, 1, 0.8);
  const before = map.Elevation.get(5);
  resolveSheetContacts(map, 40);
  expect(
    Math.max(map.FractureConductance.get(5), map.FractureConductance.get(next))
  ).toBeGreaterThan(200);
  expect(map.Elevation.get(5)).toBe(before);
});
