import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField, type PhysicalField } from "./field";
import { createMesh } from "./mesh";
import { createWorldMesh } from "./worldMesh";
import { workingArray } from "./physicalNumerics";
import type { Band } from "@atlas/domain";
import {
  discoverComponents,
  propagateInfluence,
  rankComponents,
  type BoundaryComponent,
} from "./orogenicComponents";
import { crossSection } from "./orogenicShape";

function collisionBelt(): BoundaryComponent {
  return {
    id: 0,
    code: 1,
    pair: 1,
    prominence: 2000,
    count: 10,
    area: 1e10,
    totalWeight: 0,
    shortening: 0,
    collision: 0.5,
    suture: 0.5,
    strain: 0.6,
    continental: 1,
    maximumContinental: 1,
    x: 0,
    y: 0,
  };
}

it("rises steeply on the foreland and carries a plateau on the hinterland", () => {
  const profile = atlasPhysicalProfile();
  profile.OrogenicPlateauWidth = 300_000;
  profile.OrogenicPlateauShare = 0.6;
  profile.OrogenicForelandWidthShare = 0.5;
  const map = createField(createMesh(16, 1));
  map.CrustContinentalFraction.fill(1000);
  map.CrustCollisionIntensity.fill(500);
  const context = physicalContext(1, 0, profile),
    belt = collisionBelt();
  const section = (distance: number, side: number) =>
    crossSection(map, context, belt, 0, 0, distance, side);
  const sample = (side: number) => Array.from({ length: 80 }, (_, k) => section(k * 5_000, side));
  const foreland = sample(-1),
    hinterland = sample(1);
  const crest = (values: number[]) => values.indexOf(Math.max(...values)) * 5_000;
  // The foreland reaches its crest within half the range width and is back near the plain
  // within one range width; the hinterland keeps a shoulder of the plateau share.
  expect(crest(foreland)).toBeLessThanOrEqual(profile.CollisionRangeWidth * 0.5);
  expect(section(profile.CollisionRangeWidth, -1)).toBeLessThan(0.2 * Math.max(...foreland));
  expect(section(profile.OrogenicPlateauWidth * 0.5, 1)).toBeGreaterThanOrEqual(
    0.8 * profile.OrogenicPlateauShare
  );
  // Past the plateau only the broad base Gaussian's tail remains (about 0.06 at two widths).
  expect(section(profile.OrogenicPlateauWidth * 1.2, 1)).toBeLessThan(0.1);
  // Both sides reach the same crest; the hinterland then adds the plateau share on top of it.
  const hinterlandCrest = Math.max(...hinterland.slice(0, 20)) - profile.OrogenicPlateauShare;
  expect(Math.max(...foreland)).toBeCloseTo(hinterlandCrest, 1);
  // No plateau means the symmetric section of a plains world.
  profile.OrogenicPlateauWidth = 0;
  profile.OrogenicForelandWidthShare = 1;
  expect(section(200_000, 1)).toBeCloseTo(section(200_000, -1), 12);
});

/** A north-south collision boundary at x = 0 with continental crust to its east. */
function collisionFixture(map: PhysicalField) {
  const mesh = map.mesh;
  for (let i = 0; i < mesh.count; i++) {
    if (mesh.membership(i) === 0) continue;
    map.CrustContinentalFraction.set(i, mesh.x(i) > 0 ? 1000 : 150);
    if (Math.abs(mesh.x(i)) >= 12_000) continue;
    map.TectonicBoundaryCodes.set(i, 1);
    map.TectonicBoundaryPairIds.set(i, 7);
    map.TectonicStrain.set(i, 600);
    map.TectonicTangentX.set(i, 0);
    map.TectonicTangentY.set(i, 1000);
  }
}
/** Cells of the belt away from the boundary, counted by which side they were assigned. */
function sideCounts(map: PhysicalField, side: Band) {
  const mesh = map.mesh;
  let hinterland = 0,
    foreland = 0,
    wrong = 0;
  for (let i = 0; i < mesh.count; i++) {
    if (mesh.membership(i) === 0) continue;
    if (map.OrogenicComponentIds.get(i) < 0 || Math.abs(mesh.x(i)) < 40_000) continue;
    const expected = mesh.x(i) > 0 ? 1 : -1;
    if (Math.sign(side.get(i)) !== expected) wrong++;
    else if (expected > 0) hinterland++;
    else foreland++;
  }
  return { hinterland, foreland, wrong };
}
it("places the hinterland on the side of the boundary with more continental mass", () => {
  const profile = atlasPhysicalProfile();
  const map = createField(createWorldMesh([0, 0, 600_000, 400_000], 2048, 0));
  collisionFixture(map);
  const context = physicalContext(3, 0, profile);
  const ids = workingArray(map, "int32", "test:orogenic-ids").fill(-1);
  const components = discoverComponents(map, context, ids);
  rankComponents(components, context);
  expect(components.length).toBeGreaterThan(0);
  const frame = propagateInfluence(map, context, components, ids);
  const { hinterland, foreland, wrong } = sideCounts(map, frame.side);
  expect(hinterland).toBeGreaterThan(50);
  expect(foreland).toBeGreaterThan(50);
  expect(wrong).toBe(0);
});
