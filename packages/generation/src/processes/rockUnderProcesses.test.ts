import { expect, it } from "vitest";
import { rockCatalogue, type RockKind } from "../rock/rockCatalogue";
import { setLayer } from "../rock/rockColumn";
import { atlasPhysicalProfile } from "../canonry/atlasProfile";
import { physicalContext } from "../canonry/context";
import { createField, type PhysicalField } from "../canonry/field";
import { units } from "../canonry/math";
import { releaseWorking } from "../canonry/physicalNumerics";
import { rebuild } from "../canonry/surface";
import { createWorldMesh } from "../canonry/worldMesh";
import { ice } from "./ice";
import { recordCut } from "../rock/groundLedger";
import { actBy } from "./processCatalogue";
import { hillslopeFlux } from "./slopeFlux";
import { solution } from "./solution";
import { streams, valleyShare } from "./streams";

const fluvialErosion = actBy(streams, solution),
  glacialErosion = actBy(ice);

/**
 * Rain on one tilted slope, its north half soft rock and its south half hard, running down to the
 * sea: what one pass of river cutting does with each, in about a second. Nothing else runs.
 */
const halfWidth = 600_000,
  halfHeight = 400_000,
  samples = 3000;
let tilt = 0.004;
function slope(north: RockKind, south: RockKind): PhysicalField {
  const map = createField(
    createWorldMesh([-halfWidth, -halfHeight, halfWidth, halfHeight], samples, 25_000)
  );
  for (let i = 0; i < map.mesh.count; i++) {
    const rock = map.mesh.y(i) >= 0 ? north : south,
      height = (map.mesh.x(i) + halfWidth) * tilt + 20 * Math.sin(map.mesh.y(i) / 30_000);
    setLayer(map, i, 0, rock.code, units(30_000));
    map.RockKindCodes.set(i, rock.code);
    map.RockResistance.set(i, rock.resistance);
    map.BedrockElevation.set(i, units(height));
    map.DrainageElevations.set(i, units(height));
    map.Runoff.set(i, 1000);
    map.WaterKindCodes.set(i, height <= 0 ? 1 : 0);
    rebuild(map, i);
  }
  return map;
}
const cutOn = (map: PhysicalField, keep: (y: number) => boolean) => {
  let total = 0,
    cells = 0;
  for (let i = 0; i < map.mesh.count; i++)
    if (keep(map.mesh.y(i)) && map.Elevation.get(i) > 0) {
      total += map.CumulativeFluvialErosion.get(i) / 1024;
      cells++;
    }
  return total / Math.max(1, cells);
};

function cutsAt(steep: number) {
  tilt = steep;
  const map = slope(rockCatalogue.shale, rockCatalogue.quartzite);
  fluvialErosion(map, physicalContext(1, 0, atlasPhysicalProfile(), null, 0, 1));
  return { map, soft: cutOn(map, (y) => y > 50_000), hard: cutOn(map, (y) => y < -50_000) };
}
it("cuts soft rock clearly faster than hard, on steep ground as on gentle", () => {
  for (const steep of [0.004, 0.01, 0.02, 0.05]) {
    const { soft, hard } = cutsAt(steep);
    expect(soft / hard).toBeGreaterThan(2.5);
  }
});
it("leaves hard rock standing above soft", () => {
  const { map } = cutsAt(0.02);
  let soft = 0,
    hard = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.y(i) > 50_000) soft += map.Elevation.get(i);
    if (map.mesh.y(i) < -50_000) hard += map.Elevation.get(i);
  }
  expect(hard).toBeGreaterThan(soft);
});
it("dissolves soluble rock where water runs, even off the rivers", () => {
  tilt = 0;
  const map = slope(rockCatalogue.limestone, rockCatalogue.quartzite);
  for (let i = 0; i < map.mesh.count; i++) {
    map.BedrockElevation.set(i, units(500));
    map.WaterKindCodes.set(i, 0);
    rebuild(map, i);
  }
  fluvialErosion(map, physicalContext(1, 0, atlasPhysicalProfile(), null, 0, 1));
  const soluble = cutOn(map, (y) => y > 50_000),
    tight = cutOn(map, (y) => y < -50_000);
  expect(soluble).toBeGreaterThan(50);
  expect(tight).toBeLessThan(soluble / 3);
});
const quartziteBlock = (map: PhysicalField, i: number) =>
  Math.abs(map.mesh.x(i)) < 150_000 && Math.abs(map.mesh.y(i)) < 150_000;
const inSoftBesideBlock = (map: PhysicalField, i: number) =>
  Math.abs(map.mesh.x(i)) < 150_000 && Math.abs(map.mesh.y(i)) > 200_000;
function meanOver(map: PhysicalField, keep: (i: number) => boolean, value: (i: number) => number) {
  let total = 0,
    cells = 0;
  for (let i = 0; i < map.mesh.count; i++)
    if (keep(i)) {
      total += value(i);
      cells++;
    }
  return total / Math.max(1, cells);
}
it("leaves a block of hard rock standing above the soft rock around it", () => {
  tilt = 0.02;
  const map = slope(rockCatalogue.shale, rockCatalogue.shale);
  for (let i = 0; i < map.mesh.count; i++)
    if (quartziteBlock(map, i)) {
      setLayer(map, i, 0, rockCatalogue.quartzite.code, units(30_000));
      map.RockKindCodes.set(i, rockCatalogue.quartzite.code);
      map.RockResistance.set(i, rockCatalogue.quartzite.resistance);
    }
  const before = Float64Array.from({ length: map.mesh.count }, (_, i) => map.Elevation.get(i));
  fluvialErosion(map, physicalContext(1, 0, atlasPhysicalProfile(), null, 0, 1));
  const lowered = (i: number) => (before[i] - map.Elevation.get(i)) / 1024,
    hard = meanOver(map, (i) => quartziteBlock(map, i), lowered),
    soft = meanOver(map, (i) => inSoftBesideBlock(map, i), lowered);
  expect(soft).toBeGreaterThan(5 * hard);
  expect(hard).toBeGreaterThan(0);
});
it("wears a cell whose stream is too small to map, without recording a valley", () => {
  tilt = 0.02;
  const map = slope(rockCatalogue.slate, rockCatalogue.slate),
    profile = { ...atlasPhysicalProfile(), FluvialChannelArea: Number.MAX_VALUE };
  const before = Float64Array.from({ length: map.mesh.count }, (_, i) => map.Elevation.get(i));
  fluvialErosion(map, physicalContext(1, 0, profile, null, 0, 1));
  const land = (i: number) => before[i] > units(100),
    lowered = meanOver(map, land, (i) => (before[i] - map.Elevation.get(i)) / 1024);
  expect(lowered).toBeGreaterThan(1);
  expect(meanOver(map, land, (i) => map.CumulativeFluvialErosion.get(i))).toBe(0);
});
it("widens valleys in weak rock and keeps them narrow in strong rock", () => {
  tilt = 0.02;
  const lowerings = [rockCatalogue.shale, rockCatalogue.quartzite].map((rock) => {
    const map = slope(rock, rock),
      before = Float64Array.from({ length: map.mesh.count }, (_, i) => map.Elevation.get(i));
    fluvialErosion(map, physicalContext(1, 0, atlasPhysicalProfile(), null, 0, 1));
    const channel = (i: number) => map.CumulativeFluvialErosion.get(i) > 0;
    // Mean lowering per metre of valley: the share of the cell the valley took.
    return (
      meanOver(map, channel, (i) => before[i] - map.Elevation.get(i)) /
      meanOver(map, channel, (i) => map.CumulativeFluvialErosion.get(i))
    );
  });
  expect(lowerings[0]).toBeGreaterThan(2 * lowerings[1]);
});
it("lets ice cut soft rock further than hard under the same ice", () => {
  tilt = 0.02;
  const profile = atlasPhysicalProfile(),
    map = slope(rockCatalogue.shale, rockCatalogue.quartzite);
  for (let i = 0; i < map.mesh.count; i++) {
    map.IceFlux.set(i, 2 * profile.GlacierFluxThreshold);
    map.IceThickness.set(i, 2 * profile.GlacierThicknessThreshold);
    map.GroundedIce.set(i, 1);
  }
  glacialErosion(map, physicalContext(1, 0, profile, null, 0, 1));
  const cut = (keep: (y: number) => boolean) =>
    meanOver(
      map,
      (i) => keep(map.mesh.y(i)),
      (i) => map.CumulativeGlacialErosion.get(i)
    );
  expect(cut((y) => y > 50_000)).toBeGreaterThan(3 * cut((y) => y < -50_000));
});
it("lets a scarp in soft rock shed more than the same scarp in hard rock", () => {
  tilt = 0;
  const shedFrom = (rock: RockKind, high: number) => {
    const map = slope(rock, rock);
    for (let i = 0; i < map.mesh.count; i++) {
      map.BedrockElevation.set(i, units(map.mesh.x(i) > 0 ? high : 500));
      rebuild(map, i);
    }
    const { cuts, fills } = hillslopeFlux(map, atlasPhysicalProfile());
    let shed = 0;
    for (let i = 0; i < map.mesh.count; i++) shed += cuts.get(i);
    releaseWorking(map, cuts, fills);
    return shed;
  };
  expect(shedFrom(rockCatalogue.shale, 3000)).toBeGreaterThan(
    2 * shedFrom(rockCatalogue.quartzite, 3000)
  );
  // A world cell's step of a few hundred metres is ordinary ground, and stands.
  expect(shedFrom(rockCatalogue.quartzite, 800)).toBe(0);
});
it("lowers a cell's mean by the valley's share of it and remembers the valley's own depth", () => {
  const map = slope(rockCatalogue.shale, rockCatalogue.shale),
    was = map.Elevation.get(0);
  recordCut(map, 0, units(100), 0.1);
  expect((was - map.Elevation.get(0)) / 1024).toBeCloseTo(10, 1);
  expect(map.CumulativeFluvialErosion.get(0) / 1024).toBeCloseTo(100, 1);
});
it("gives a valley more of a coarse cell the bigger its catchment and all of a fine cell", () => {
  const widthShare = 0.05,
    catchment = 1e10;
  expect(valleyShare(widthShare, catchment, 28_000 ** 2)).toBeCloseTo(0.179, 2);
  expect(valleyShare(widthShare, catchment, 3_500 ** 2)).toBe(1);
  expect(valleyShare(widthShare, 1e13, 28_000 ** 2)).toBe(1);
});
