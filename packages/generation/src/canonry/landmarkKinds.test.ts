import { expect, it } from "vitest";
import type { Landmark } from "@atlas/domain";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { units } from "./math";
import { nearestTriangle } from "./mesh";
import { emplaceLandmark, maintainLandmark, type LandmarkLedger } from "./landmarks";

/** A flat continent at 500 m with land everywhere; the datum is sea level. */
function plateau() {
  const map = createField(createWorldMesh([0, 0, 600_000, 600_000], 1024, 0));
  map.BedrockElevation.fill(units(500));
  map.Elevation.fill(units(500));
  map.CrustThickness.fill(units(4000));
  map.CrustContinentalFraction.fill(1000);
  map.RockResistance.fill(1000);
  return map;
}
const mountain: Landmark = {
  id: "m",
  name: "Peak",
  kind: "volcanic-mountain",
  geometry: { type: "Point", coordinates: [300_000, 300_000] },
  parameters: { summit: 3000, prominence: 2000, baseRadius: 60 },
  emplacedAtEpoch: 0,
};

it("raises a mountain to its summit and restores it after the summit is lowered", () => {
  const map = plateau(),
    p = atlasPhysicalProfile(),
    ledger: LandmarkLedger = new Map();
  const record = emplaceLandmark(map, p, mountain, 0, ledger)!;
  expect(record.realized).toBe(true);
  expect(record.measured.summit).toBeGreaterThanOrEqual(3000);
  expect(record.measured.prominence).toBeGreaterThanOrEqual(2000);
  expect(Object.keys(record.target).sort()).toEqual(["prominence", "summit"]);
  // The whole edifice loses 700 m, as a glacial epoch might take; the signature is restored.
  const centre = nearestTriangle(map.mesh, 0, 0);
  for (let i = 0; i < map.mesh.count; i++) {
    if (Math.hypot(map.mesh.x[i], map.mesh.y[i]) > 60_000) continue;
    map.BedrockElevation[i] -= units(700);
    map.Elevation[i] -= units(700);
  }
  expect(map.Elevation[centre]).toBe(units(2300));
  const held = maintainLandmark(map, p, mountain, 1, ledger)!;
  expect(held.measured.summit).toBeGreaterThanOrEqual(3000);
  expect(held.maintenance).toBeGreaterThan(0);
  expect(map.LandmarkMaintenance[centre]).toBeGreaterThan(0);
  expect(map.Elevation[centre]).toBe(map.BedrockElevation[centre] + map.SedimentThickness[centre]);
});
