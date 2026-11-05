import { expect, it } from "vitest";
import { rockCatalogue, type RockKind } from "../rock/rockCatalogue";
import { setLayer } from "../rock/rockColumn";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField, type PhysicalField } from "./field";
import { fluvialErosion, recordCut, valleyShare } from "./fluvial";
import { units } from "./math";
import { rebuild } from "./surface";
import { createWorldMesh } from "./worldMesh";

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
