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
    if (Math.hypot(map.mesh.x(i), map.mesh.y(i)) > 60_000) continue;
    map.BedrockElevation.add(i, -units(700));
    map.Elevation.add(i, -units(700));
  }
  expect(map.Elevation.get(centre)).toBe(units(2300));
  const held = maintainLandmark(map, p, mountain, 1, ledger)!;
  expect(held.measured.summit).toBeGreaterThanOrEqual(3000);
  expect(held.maintenance).toBeGreaterThan(0);
  expect(map.LandmarkMaintenance.get(centre)).toBeGreaterThan(0);
  expect(map.Elevation.get(centre)).toBe(
    map.BedrockElevation.get(centre) + map.SedimentThickness.get(centre)
  );
});

/** Kinds drawn narrower than a cell of this mesh still measure from real cells on both sides. */
const small: Landmark[] = [
  {
    id: "scarp",
    name: "Scarp",
    kind: "escarpment",
    geometry: {
      type: "LineString",
      coordinates: [
        [200_000, 300_000],
        [300_000, 310_000],
        [400_000, 300_000],
      ],
    },
    parameters: { throw: 400, scarpWidth: 6 },
    emplacedAtEpoch: 0,
  },
  {
    id: "dome",
    name: "Dome",
    kind: "dome-ring",
    geometry: { type: "Point", coordinates: [150_000, 150_000] },
    parameters: { diameter: 40, ringCount: 3, ringRelief: 120 },
    emplacedAtEpoch: 0,
  },
  {
    id: "crater",
    name: "Crater",
    kind: "impact-ring",
    geometry: { type: "Point", coordinates: [450_000, 150_000] },
    parameters: { diameter: 40, rimHeight: 200, floorDepth: 300 },
    emplacedAtEpoch: 0,
  },
];

it("measures narrow kinds from whole cells and holds the realized ones after relief loss", () => {
  const map = plateau(),
    p = atlasPhysicalProfile(),
    ledger: LandmarkLedger = new Map();
  expect(map.mesh.spacing).toBeGreaterThan(6_000);
  for (const landmark of small) {
    const record = emplaceLandmark(map, p, landmark, 0, ledger)!;
    for (const key of Object.keys(record.target))
      expect(Number.isFinite(record.measured[key]), `${landmark.kind} ${key}`).toBe(true);
  }
  // The epoch's maintenance holds every realized signature, then relief relaxes toward the
  // plateau and the next maintenance restores it.
  for (let epoch = 0; epoch < 2; epoch++) {
    if (epoch > 0)
      for (let i = 0; i < map.mesh.count; i++) {
        map.BedrockElevation.set(i, units(500) + (map.BedrockElevation.get(i) - units(500)) * 0.6);
        map.Elevation.set(i, map.BedrockElevation.get(i) + map.SedimentThickness.get(i));
      }
    for (const landmark of small) {
      const record = maintainLandmark(map, p, landmark, epoch, ledger)!;
      if (!record.realized) continue;
      for (const [key, target] of Object.entries(record.target))
        expect(
          record.measured[key],
          `${landmark.kind} ${key} held in epoch ${epoch}`
        ).toBeGreaterThanOrEqual(target - 0.01);
    }
  }
  expect(ledger.get("scarp")!.realized).toBe(true);
  expect(ledger.get("crater")!.realized).toBe(true);
});
