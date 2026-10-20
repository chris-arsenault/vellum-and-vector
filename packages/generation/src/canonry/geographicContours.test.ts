import { expect, it } from "vitest";
import { macroFixture } from "./macroFixtures";
import { createWorldMesh } from "./worldMesh";
import { atlasPhysicalProfile } from "./atlasProfile";
import { membershipContour } from "./geographicContours";

it("closes selected fans that touch the numerical boundary through shared vertices", () => {
  const state = macroFixture(32),
    mesh = createWorldMesh(
      [0, 0, 4_000_000, 3_000_000],
      65536,
      atlasPhysicalProfile().BoundaryPadding
    ),
    members = [
      57737, 57803, 65165, 57802, 65166, 65167, 65134, 65199, 65200, 65232, 65201, 65233, 65231,
      65169, 65265, 65234, 65230, 65263, 65266, 65264, 65229, 65298, 65267, 65296, 65261,
    ],
    selected = new Set(members);
  // Contouring reads only the mesh and the supplied membership field.
  state.physical!.map.mesh = mesh;
  expect(members.some((i) => mesh.boundary[i])).toBe(false);
  expect(membershipContour(state, members, (i) => Number(selected.has(i)))?.type).toBe("Polygon");
});
