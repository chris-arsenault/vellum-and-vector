import { expect, it } from "vitest";
import { rockCatalogue } from "../rock/rockCatalogue";
import { setLayer } from "../rock/rockColumn";
import { actBy } from "../processes/processCatalogue";
import { solution } from "../processes/solution";
import { streams } from "../processes/streams";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext, type PhysicalEpoch } from "./context";
import { createField, type PhysicalField } from "./field";
import { units } from "./math";
import { orogenicConstruction } from "./orogeny";
import { rebuild } from "./surface";
import { createWorldMesh } from "./worldMesh";

/**
 * One straight convergent boundary through a continent, with no plate motion and no erosion: what
 * repeated passes of mountain building do on their own, in well under a second. No generation runs.
 */
const spacing = 25_000,
  halfWidth = 1_000_000,
  halfHeight = 500_000,
  samples = 3200,
  pair = 7,
  strain = 400,
  drift = 561_600;
const epoch: PhysicalEpoch = {
  StableName: "belt",
  TectonicStrength: 1000,
  HydrologyStrength: 0,
  GlaciationStrength: 0,
  CoastalStrength: 0,
  TemperatureOffset: 0,
  SeaLevelOffset: 0,
};
function column(map: PhysicalField, i: number) {
  const { sandstone, shale, limestone, gneiss } = rockCatalogue;
  setLayer(map, i, 0, sandstone.code, units(200));
  setLayer(map, i, 1, shale.code, units(600));
  setLayer(map, i, 2, limestone.code, units(1000));
  setLayer(map, i, 3, gneiss.code, units(30_000));
  map.RockKindCodes.set(i, sandstone.code);
  map.RockResistance.set(i, sandstone.resistance);
}
function belt(boundary = 1) {
  const map = createField(
    createWorldMesh([-halfWidth, -halfHeight, halfWidth, halfHeight], samples, spacing)
  );
  map.EffectiveSeaLevel = units(-200);
  map.BaseSeaLevel = map.EffectiveSeaLevel;
  for (let i = 0; i < map.mesh.count; i++) {
    map.CrustContinentalFraction.set(i, 1000);
    map.CrustThickness.set(i, units(4000));
    map.CrustContinentalColumn.set(i, units(4000));
    map.CrustRootReserve.set(i, units(30));
    map.SurfaceRockLoad.set(i, units(300));
    map.BedrockElevation.set(i, units(300));
    column(map, i);
    if (Math.abs(map.mesh.x(i)) <= map.mesh.spacing * 1.2) {
      map.TectonicBoundaryCodes.set(i, boundary);
      map.TectonicBoundaryPairIds.set(i, pair);
      map.TectonicStrain.set(i, strain);
      map.TectonicTangentY.set(i, 1000);
    }
    rebuild(map, i);
  }
  return map;
}
function runPass(map: PhysicalField, pass: number) {
  const profile = atlasPhysicalProfile();
  map.LastPlateDriftStep = pass === 0 ? 0 : drift;
  // The first pass is the world forming; after it, plates carry the crust.
  map.CrustFormed = pass > 0;
  orogenicConstruction(
    map,
    pass === 0
      ? physicalContext(1, 0x7249d3, profile, null, 0, 3)
      : physicalContext(1, 0x7249d3, profile, epoch, pass - 1, 3)
  );
}
/** The cells of one line across the belt, away from the map's edges. */
function lineAcross(map: PhysicalField) {
  const cells: number[] = [];
  for (let x = -halfWidth + 4 * spacing; x < halfWidth - 4 * spacing; x += spacing / 2) {
    const i = map.mesh.cellAt(x, 0);
    if (i >= 0 && cells.at(-1) !== i) cells.push(i);
  }
  return cells;
}
const metres = (map: PhysicalField, i: number) => Math.round(map.SurfaceRockLoad.get(i) / 1024);
const foreland = (map: PhysicalField) => lineAcross(map).filter((i) => map.mesh.x(i) > 0);
/** The cells along a line that stand well above both sides. */
function ridgesOn(map: PhysicalField, line: readonly number[]) {
  return line.filter(
    (i, n) =>
      n > 0 &&
      n < line.length - 1 &&
      metres(map, i) > metres(map, line[n - 1]) + 300 &&
      metres(map, i) > metres(map, line[n + 1]) + 300
  );
}

it("keeps a rift's fault blocks from pass to pass and deepens the steps between them", () => {
  const map = belt(2),
    line = () => foreland(map).filter((i) => map.ThrustSheetIndex.get(i) > 0),
    // A rift moves the crust itself; the ground follows when the crust's support is next worked out.
    ground = (i: number) => map.CrustThickness.get(i) / 1024;
  runPass(map, 0);
  const cells = line(),
    blocks = cells.map((i) => map.ThrustSheetIndex.get(i)),
    spread = () => Math.max(...cells.map(ground)) - Math.min(...cells.map(ground));
  expect(new Set(blocks).size).toBeGreaterThan(1);
  const first = spread();
  for (let pass = 1; pass < 4; pass++) runPass(map, pass);
  expect(cells.map((i) => map.ThrustSheetIndex.get(i))).toEqual(blocks);
  expect(spread()).toBeGreaterThan(first);
});
it("keeps building while crust keeps arriving", () => {
  const map = belt(),
    built: number[] = [];
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < map.mesh.count; i++) {
      if (map.TectonicBoundaryCodes.get(i) === 1) map.CrustRootReserve.add(i, units(800));
    }
    runPass(map, pass);
    let total = 0;
    for (let i = 0; i < map.mesh.count; i++) total += map.OrogenicConstruction.get(i) / 1024;
    built.push(total);
  }
  // Early passes also spend what the first pass left over; after that, supply sets the pace.
  expect(built[7]).toBeGreaterThan(built[5] * 0.9);
});
const sampleGap = 60_000;
/** Pairs of belt cells a set distance apart, along the belt (north) and across it (east). */
function beltPairs(map: PhysicalField) {
  const along: [number, number][] = [],
    across: [number, number][] = [],
    cell = (x: number, y: number) => map.mesh.cellAt(x, y);
  for (let x = -300_000; x < 300_000; x += 15_000)
    for (let y = -300_000; y < 300_000; y += 15_000) {
      const i = cell(x, y),
        north = cell(x, y + sampleGap),
        east = cell(x + sampleGap, y),
        inBelt = (j: number) => j >= 0 && map.ThrustSheetIndex.get(j) > 0;
      if (!inBelt(i)) continue;
      if (inBelt(north)) along.push([i, north]);
      if (inBelt(east)) across.push([i, east]);
    }
  return { along, across };
}
const shareSame = (map: PhysicalField, pairs: readonly [number, number][]) =>
  pairs.filter(([a, b]) => map.RockKindCodes.get(a) === map.RockKindCodes.get(b)).length /
  pairs.length;
const meanStep = (map: PhysicalField, pairs: readonly [number, number][]) =>
  pairs.reduce((sum, [a, b]) => sum + Math.abs(map.Elevation.get(a) - map.Elevation.get(b)), 0) /
  pairs.length;
it("exposes rock in bands that run along the belt", () => {
  const map = belt();
  for (let pass = 0; pass < 4; pass++) runPass(map, pass);
  const { along, across } = beltPairs(map),
    kinds = new Set(foreland(map).map((i) => map.RockKindCodes.get(i)));
  expect(kinds.size).toBeGreaterThan(1);
  expect(shareSame(map, along)).toBeGreaterThan(shareSame(map, across) + 0.1);
});
it("keeps ridges steeper across the belt than along it after rivers have cut them", () => {
  const map = belt();
  for (let pass = 0; pass < 4; pass++) runPass(map, pass);
  for (let i = 0; i < map.mesh.count; i++) {
    const fall = units((map.mesh.y(i) + halfHeight) * 0.002);
    map.BedrockElevation.add(i, fall);
    map.DrainageElevations.set(i, map.BedrockElevation.get(i));
    map.Runoff.set(i, 1000);
    rebuild(map, i);
  }
  const { along, across } = beltPairs(map),
    before = meanStep(map, across) / meanStep(map, along);
  actBy(streams, solution)(map, physicalContext(1, 0, atlasPhysicalProfile(), null, 0, 1));
  const after = meanStep(map, across) / meanStep(map, along);
  expect(after).toBeGreaterThan(before);
});
it("builds an arc from root crust where a belt has no continent to build on", () => {
  const map = belt();
  for (let i = 0; i < map.mesh.count; i++) {
    map.CrustContinentalFraction.set(i, 0);
    map.CrustContinentalColumn.set(i, 0);
    map.CrustThickness.set(i, units(1000));
    map.CrustRootReserve.set(i, map.TectonicBoundaryCodes.get(i) === 1 ? units(400) : 0);
  }
  const held = () => {
    let total = 0;
    for (let i = 0; i < map.mesh.count; i++) total += map.CrustRootReserve.get(i);
    return total;
  };
  runPass(map, 0);
  const before = held();
  runPass(map, 1);
  expect(held()).toBeLessThan(before * 0.8);
  // What the reserve gave now stands as thicker crust or as rock on it, somewhere along the belt.
  let built = 0;
  for (let i = 0; i < map.mesh.count; i++)
    built += map.CrustThickness.get(i) - units(1000) + Math.max(0, map.SurfaceRockLoad.get(i));
  expect(built).toBeGreaterThan(0);
});
it("settles root crust stranded on ground no convergent belt reaches", () => {
  const map = belt(2),
    far = map.mesh.cellAt(100_000, 0);
  runPass(map, 0);
  const crust = map.CrustThickness.get(far);
  map.CrustRootReserve.set(far, units(1000));
  runPass(map, 1);
  expect(map.CrustRootReserve.get(far)).toBeLessThanOrEqual(units(500));
  expect(map.CrustThickness.get(far)).toBeGreaterThan(crust + units(100));
});
it("numbers a belt's sheets in order outward from its boundary", () => {
  const map = belt();
  for (let pass = 0; pass < 4; pass++) runPass(map, pass);
  const sheets = foreland(map)
    .map((i) => map.ThrustSheetIndex.get(i))
    .filter((sheet) => sheet > 0);
  expect(sheets.length).toBeGreaterThan(5);
  sheets.forEach((sheet, n) => {
    if (n > 0) expect(sheet).toBeGreaterThanOrEqual(sheets[n - 1]);
  });
});
it("takes in new sheets on each pass of shortening", () => {
  const map = belt(),
    newest: number[] = [];
  for (let pass = 0; pass < 4; pass++) {
    runPass(map, pass);
    let highest = 0;
    for (let i = 0; i < map.mesh.count; i++)
      highest = Math.max(highest, map.ThrustSheetIndex.get(i));
    newest.push(highest);
  }
  for (let pass = 1; pass < 4; pass++) expect(newest[pass]).toBeGreaterThan(newest[pass - 1]);
});
/** Plates keep closing: the crust they shorten reaches the boundary for the next pass. */
function crustArrives(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++)
    if (map.TectonicBoundaryCodes.get(i) === 1) map.CrustRootReserve.add(i, units(3000));
}
it("builds a train of separate ridges, not one swell", () => {
  const map = belt();
  for (let pass = 0; pass < 4; pass++) {
    crustArrives(map);
    runPass(map, pass);
  }
  expect(ridgesOn(map, foreland(map)).length).toBeGreaterThanOrEqual(3);
});
it("stops raising ridges once no more crust reaches the belt", () => {
  const rockOn = (map: PhysicalField) => {
    let total = 0;
    for (let i = 0; i < map.mesh.count; i++) total += map.SurfaceRockLoad.get(i) / 1024;
    return total;
  };
  const closing = belt(),
    stopped = belt();
  for (let pass = 0; pass < 6; pass++) {
    crustArrives(closing);
    if (pass < 2) crustArrives(stopped);
    runPass(closing, pass);
    runPass(stopped, pass);
  }
  expect(rockOn(closing)).toBeGreaterThan(rockOn(stopped));
});
it("keeps a crest in one piece along the belt instead of breaking it into single cells", () => {
  const map = belt();
  for (let pass = 0; pass < 4; pass++) runPass(map, pass);
  const crest = (i: number) => metres(map, i) >= 1500,
    seen = new Set<number>();
  let longest = 0;
  for (let start = 0; start < map.mesh.count; start++) {
    if (seen.has(start) || !crest(start)) continue;
    const stack = [start];
    let north = -Infinity,
      south = Infinity;
    seen.add(start);
    while (stack.length) {
      const i = stack.pop()!;
      north = Math.max(north, map.mesh.y(i));
      south = Math.min(south, map.mesh.y(i));
      for (let edge = 0; edge < map.mesh.degree(i); edge++) {
        const j = map.mesh.neighbor(i, edge);
        if (j >= 0 && !seen.has(j) && crest(j)) {
          seen.add(j);
          stack.push(j);
        }
      }
    }
    longest = Math.max(longest, north - south);
  }
  expect(longest).toBeGreaterThan(halfHeight);
});
it("raises a ridge in the same place on every later pass", () => {
  const map = belt();
  crustArrives(map);
  runPass(map, 0);
  const [first] = ridgesOn(map, foreland(map)),
    heights = [metres(map, first)];
  for (let pass = 1; pass < 4; pass++) {
    crustArrives(map);
    runPass(map, pass);
    heights.push(metres(map, first));
  }
  for (let pass = 1; pass < 4; pass++) expect(heights[pass]).toBeGreaterThan(heights[pass - 1]);
});
