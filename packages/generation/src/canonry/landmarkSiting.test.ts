import { expect, it } from "vitest";
import { landmarkKind } from "@atlas/domain";
import { createWorldMesh } from "./worldMesh";
import { createField, type PhysicalField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { drainageConditioning } from "./drainageFlood";
import { drainageGuidance } from "./flowGuidance";
import { flowRouting } from "./routing";
import { riverNetwork } from "./rivers";
import { units } from "./math";
import { nearestTriangle } from "./mesh";
import { distance, type Point } from "./landmarkGeometry";
import { analyseTerrain, height, within, relief } from "./landmarkSitingRules";
import {
  freeOrdinals,
  generatedLandmark,
  landmarkId,
  landmarkRoster,
  siteLandmark,
  type Taken,
} from "./landmarkSiting";

const km = 1000,
  seed = 7919;

/**
 * A constructed continent: sea beyond 900 km east-west and 400 km north-south, plains at
 * 300 m in the west, a range at 2,500 m across the middle, a plateau at 1,200 m in the east
 * sloping to its coast so that a river runs off it.
 */
function continent() {
  const map = createField(createWorldMesh([0, 0, 2_000_000, 1_000_000], 4096, 0)),
    context = physicalContext(seed, 0, atlasPhysicalProfile());
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x[i],
      y = map.mesh.y[i],
      sea = Math.abs(x) > 900 * km || Math.abs(y) > 400 * km;
    let metres = 300;
    if (Math.abs(x) <= 100 * km) metres = 2500 - (Math.abs(x) / (100 * km)) * 600;
    else if (x > 100 * km) metres = 1200 - ((x - 100 * km) / (800 * km)) * 500 - Math.abs(y) / 4000;
    map.WaterKindCodes[i] = sea ? 1 : 0;
    map.Elevation[i] = units(sea ? -500 : metres);
    map.BedrockElevation[i] = map.Elevation[i];
    map.CrustThickness[i] = units(4000);
    map.CrustContinentalFraction[i] = 1000;
    map.RockResistance[i] = 1000;
    map.Runoff[i] = sea ? 0 : x > 100 * km ? 800 : 100;
  }
  drainageConditioning(map, context);
  drainageGuidance(map, context);
  flowRouting(map, context);
  riverNetwork(map, context);
  return map;
}
const at = (map: PhysicalField, i: number): Point => [map.mesh.x[i], map.mesh.y[i]];
const entry = (kind: string, ordinal = 0) => ({ ordinal, kind, epoch: 1 });

it("draws a seeded roster of kinds and forming epochs for the shortfall", () => {
  const roster = landmarkRoster(seed, [0, 1, 2, 3, 4, 5, 6], 4);
  expect(roster.map((e) => e.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(new Set(roster.map((e) => e.kind)).size).toBe(7);
  for (const e of roster) {
    expect(e.epoch).toBeGreaterThanOrEqual(0);
    expect(e.epoch).toBeLessThanOrEqual(3);
    if (e.kind === "falls" || e.kind === "canyon") expect(e.epoch).toBeGreaterThanOrEqual(1);
    else expect(e.epoch).toBeLessThanOrEqual(2);
  }
  expect(landmarkRoster(seed, [0, 1, 2], 4)).toEqual(roster.slice(0, 3));
  expect(landmarkRoster(seed + 1, [0, 1, 2], 4)).not.toEqual(roster.slice(0, 3));
  // A one-epoch world still forms everything in its only epoch.
  expect(landmarkRoster(seed, [0, 1, 2, 3], 1).every((e) => e.epoch === 0)).toBe(true);
});

it("sites each kind where its terrain reading says it belongs", () => {
  const map = continent(),
    t = analyseTerrain(map);
  expect(t.rivers.length).toBeGreaterThan(0);

  const mountain = siteLandmark(t, entry("volcanic-mountain"), seed, [])!;
  expect(mountain).not.toBeNull();
  const peak = mountain.site.center,
    r = mountain.parameters.baseRadius * km;
  expect(height(map, peak)).toBeLessThanOrEqual(1500);
  expect(relief(map, within(map, peak, r))).toBeLessThanOrEqual(400);
  expect(Math.abs(map.mesh.x[peak])).toBeGreaterThan(100 * km + r);
  expect(t.sea[peak]).toBeGreaterThanOrEqual(1.5 * r);
  // The summit is set above the local base by the seeded prominence.
  expect(mountain.parameters.summit).toBeGreaterThanOrEqual(
    height(map, peak) + mountain.parameters.prominence - 50
  );

  const falls = siteLandmark(t, entry("falls"), seed, [])!;
  expect(falls).not.toBeNull();
  expect(map.RiverOrders[falls.site.center]).toBeGreaterThan(0);
  expect(height(map, falls.site.center)).toBeGreaterThanOrEqual(150);
  expect(falls.parameters.drop).toBeLessThanOrEqual(0.5 * height(map, falls.site.center));

  const canyon = siteLandmark(t, entry("canyon"), seed, [])!;
  expect(canyon).not.toBeNull();
  const head = canyon.site.center;
  expect(height(map, head)).toBeGreaterThanOrEqual(300);
  expect(canyon.site.path).toHaveLength(3);
  expect(distance(map, head, canyon.site.path[2])).toBeGreaterThanOrEqual(37 * km);
  for (const p of canyon.site.path)
    expect(map.WaterKindCodes[nearestTriangle(map.mesh, ...p)]).toBe(0);
  const nearestRiver = Math.min(...t.rivers.map((i) => distance(map, i, at(map, head))));
  expect(nearestRiver).toBeLessThanOrEqual(canyon.parameters.captureDistance * km);
  expect(canyon.parameters.depth).toBeLessThanOrEqual(0.8 * height(map, head) + 1);

  const scarp = siteLandmark(t, entry("escarpment"), seed, [])!;
  expect(scarp).not.toBeNull();
  const [a, , b] = scarp.site.path,
    w = scarp.parameters.scarpWidth * km,
    dx = b[0] - a[0],
    dy = b[1] - a[1],
    span = Math.hypot(dx, dy),
    mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    side = (sign: number) =>
      map.Elevation[
        nearestTriangle(
          map.mesh,
          mid[0] + (sign * dy * 3 * w) / span,
          mid[1] - (sign * dx * 3 * w) / span
        )
      ];
  // The right-hand side of the drawn line is the lower ground the scarp drops to.
  expect(side(1)).toBeLessThan(side(-1));
  expect(span).toBeGreaterThanOrEqual(37 * km);

  for (const kind of ["dome-ring", "impact-ring", "resistant-mountain"]) {
    const ring = siteLandmark(t, entry(kind), seed, [])!;
    expect(ring, kind).not.toBeNull();
    expect(map.WaterKindCodes[ring.site.center]).toBe(0);
  }
});

it("keeps new landmarks apart from the ones already standing and is deterministic", () => {
  const map = continent(),
    t = analyseTerrain(map),
    first = siteLandmark(t, entry("volcanic-mountain", 0), seed, [])!,
    taken: Taken[] = [
      {
        point: first.site.path[0],
        reach: landmarkKind("volcanic-mountain")!.reach(first.parameters),
      },
    ],
    second = siteLandmark(t, entry("resistant-mountain", 1), seed, taken)!;
  expect(second).not.toBeNull();
  expect(distance(map, second.site.center, first.site.path[0])).toBeGreaterThanOrEqual(200 * km);
  expect(siteLandmark(t, entry("volcanic-mountain", 0), seed, [])).toEqual(first);
  expect(siteLandmark(t, entry("volcanic-mountain", 0), seed + 1, [])!.site.center).not.toBe(
    first.site.center
  );
});

const near = (x: number, y: number, cx: number, cy: number, radius: number) =>
  Math.hypot(x - cx, y - cy) < radius;
/** Deep water off the far coasts, a cold icy range in the middle. */
function paintSeasAndIce(map: PhysicalField, i: number) {
  const x = map.mesh.x[i],
    sea = map.WaterKindCodes[i] === 1;
  map.WaterDepths[i] = sea ? units(Math.abs(x) > 950 * km ? 3000 : 500) : 0;
  map.Temperature[i] = Math.abs(x) <= 100 * km ? 250 : 320;
  map.IceThickness[i] = Math.abs(x) <= 60 * km && !sea ? 300 : 0;
}
/** A hot spot on the western plains, a wet wood on the eastern plateau, a dry basin south. */
function paintLife(map: PhysicalField, i: number) {
  const x = map.mesh.x[i],
    y = map.mesh.y[i],
    wood = near(x, y, 500 * km, 200 * km, 120 * km),
    basin = near(x, y, 500 * km, -250 * km, 100 * km);
  map.HeatSourceDensity[i] = near(x, y, -500 * km, 150 * km, 80 * km) ? 900 : 0;
  map.TreeCover[i] = wood ? 0.8 : 0.1;
  map.Moisture[i] = wood ? 800 : basin ? 150 : 450;
  map.LakeMemory[i] = near(x, y, 500 * km, -250 * km, 30 * km) ? 20 : 0;
}
/** The continent with each system's medium painted somewhere specific. */
function enchanted() {
  const map = continent();
  for (let i = 0; i < map.mesh.count; i++) {
    paintSeasAndIce(map, i);
    paintLife(map, i);
  }
  return map;
}

it("still finds a site for every magic kind on a continent with no medium painted", () => {
  const map = continent(),
    t = analyseTerrain(map);
  for (const kind of [
    "fire-wellspring",
    "aurora-vault",
    "pressure-locus",
    "greenwood-heart",
    "salt-pan",
  ]) {
    const found = siteLandmark(t, entry(kind), seed, []);
    expect(found, kind).not.toBeNull();
    expect(map.WaterKindCodes[found!.site.center]).toBe(kind === "pressure-locus" ? 1 : 0);
  }
});

it("sites each magic kind in its system's own medium", () => {
  const map = enchanted(),
    t = analyseTerrain(map),
    sited = (kind: string) => siteLandmark(t, entry(kind), seed, [])!;
  const wellspring = sited("fire-wellspring");
  expect(wellspring).not.toBeNull();
  expect(map.HeatSourceDensity[wellspring.site.center]).toBeGreaterThanOrEqual(300);
  const vault = sited("aurora-vault");
  expect(vault).not.toBeNull();
  expect(map.IceThickness[vault.site.center]).toBeGreaterThan(0);
  const locus = sited("pressure-locus");
  expect(locus).not.toBeNull();
  expect(map.WaterKindCodes[locus.site.center]).toBe(1);
  expect(map.WaterDepths[locus.site.center]).toBeGreaterThanOrEqual(units(1500));
  const heart = sited("greenwood-heart");
  expect(heart).not.toBeNull();
  expect(map.TreeCover[heart.site.center]).toBeGreaterThanOrEqual(0.4);
  const pan = sited("salt-pan");
  expect(pan).not.toBeNull();
  expect(map.Moisture[pan.site.center]).toBeLessThanOrEqual(400);
  expect(map.LakeMemory[pan.site.center]).toBeGreaterThan(0);
  for (const found of [wellspring, vault, locus, heart, pan])
    expect(found.parameters.reach * km).toBeGreaterThanOrEqual(map.mesh.spacing);
});

it("rosters magic kinds only from the systems a run generates", () => {
  const roster = landmarkRoster(seed, [4, 5, 6], 3, ["fire-wellspring", "pressure-locus"]);
  expect(
    roster.map((e) => e.kind).every((k) => ["fire-wellspring", "pressure-locus"].includes(k))
  ).toBe(true);
  expect(roster.map((e) => e.ordinal)).toEqual([4, 5, 6]);
  expect(landmarkRoster(seed, [0], 3, [])).toEqual([]);
  const later = landmarkRoster(seed, [0, 1, 2, 3, 4, 5], 3, [
    "aurora-vault",
    "salt-pan",
    "greenwood-heart",
  ]);
  for (const e of later) expect(e.epoch).toBeGreaterThanOrEqual(1);
});

it("records a sited landmark under a stable id at its present-day position", () => {
  const map = continent(),
    t = analyseTerrain(map),
    world = { id: "3b1c9f4e-7d2a-4c58-9e61-0f5a2b7c8d90", landmarks: [] },
    found = siteLandmark(t, entry("canyon", 2), seed, [])!,
    landmark = generatedLandmark(
      map,
      world,
      { areaId: "area", spaceId: "space" },
      { ordinal: 2, kind: "canyon", epoch: 1 },
      found.site,
      found.parameters,
      []
    );
  expect(landmark).toMatchObject({
    id: landmarkId(world, "area", 2),
    name: "",
    kind: "canyon",
    origin: "generated",
    emplacedAtEpoch: 1,
    areaId: "area",
    spaceId: "space",
  });
  expect(landmark.geometry.type).toBe("LineString");
  const [x, y] = (landmark.geometry as GeoJSON.LineString).coordinates[0];
  expect(x).toBeCloseTo(found.site.path[0][0] + map.mesh.origin[0], 0);
  expect(y).toBeCloseTo(found.site.path[0][1] + map.mesh.origin[1], 0);
  expect(freeOrdinals({ ...world, landmarks: [landmark] }, "area", 3)).toEqual([0, 1, 3]);
});
