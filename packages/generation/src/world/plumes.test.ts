import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField } from "./field";
import { nearestTriangle } from "./mesh";
import { mantlePlumeRoots } from "./plumes";
import { tectonicProvinces } from "./provinces";
import { createWorldMesh } from "./worldMesh";

it("always puts a plume under an ocean plate", () => {
  const map = createField(createWorldMesh([0, 0, 4_000_000, 3_000_000], 4096, 0)),
    context = physicalContext(11, 0, atlasPhysicalProfile());
  tectonicProvinces(map, context);
  mantlePlumeRoots(map, context);
  const plumes = map.events.filter((event) => event.kind === "plume"),
    under = plumes.filter((plume) => {
      const province = map.CrustProvinceIds.get(nearestTriangle(map.mesh, plume.x, plume.y));
      return map.tectonics!.sites[province - 1].oceanPlate > 0;
    });
  expect(under.length).toBeGreaterThan(0);
});
