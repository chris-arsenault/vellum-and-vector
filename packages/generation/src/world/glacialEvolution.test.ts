import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField } from "./field";
import { glacialDeposition } from "./glacialEvolution";
import { units } from "./math";
import { createWorldMesh } from "./worldMesh";

it("builds a moraine no higher than a slope can hold, however much the ice carries", () => {
  const map = createField(createWorldMesh([0, 0, 1_000_000, 1_000_000], 64, 0)),
    profile = atlasPhysicalProfile(),
    context = physicalContext(1, 0, profile, null, 0, 1),
    ice = 0;
  map.IceFlowTargets.fill(-1);
  map.GroundedIce.set(ice, 1);
  map.SedimentSupply.set(ice, units(20_000));
  glacialDeposition(map, context);
  const holds =
    profile.MassWastingStableGradient * Math.min(profile.HillslopeLength, map.mesh.spacing);
  expect(map.SedimentThickness.get(ice)).toBeGreaterThan(0);
  expect(map.SedimentThickness.get(ice) / 1024).toBeLessThanOrEqual(holds + 1);
});
