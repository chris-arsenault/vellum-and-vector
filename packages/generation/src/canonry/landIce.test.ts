import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField } from "./field";
import { landIce } from "./landIce";
import { units } from "./math";
import { createMesh } from "./mesh";

function iceOnWarmPlateau(altitudeBalance: number) {
  const profile = atlasPhysicalProfile();
  profile.IceAltitudeBalance = altitudeBalance;
  const map = createField(createMesh(16, 1));
  // A 4,000 m plateau whose annual mean is +10 °C: climate alone would not freeze it.
  map.Elevation.fill(units(4000));
  map.Temperature.fill(400);
  map.Moisture.fill(400);
  landIce(map, physicalContext(1, 0, profile));
  return Math.max(...map.IceThickness);
}

it("lets climate decide whether a plateau freezes unless an altitude bonus is declared", () => {
  expect(iceOnWarmPlateau(0)).toBe(0);
  expect(iceOnWarmPlateau(0.25)).toBeGreaterThanOrEqual(
    atlasPhysicalProfile().GlacierThicknessThreshold
  );
});
