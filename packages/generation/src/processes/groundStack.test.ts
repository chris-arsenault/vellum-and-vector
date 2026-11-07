import { expect, it } from "vitest";
import { rockCatalogue, type RockKind } from "../rock/rockCatalogue";
import { setLayer } from "../rock/rockColumn";
import { atlasPhysicalProfile } from "../world/atlasProfile";
import { physicalContext } from "../world/context";
import { createField, type PhysicalField } from "../world/field";
import { units } from "../world/math";
import { rebuild } from "../world/surface";
import { createWorldMesh } from "../world/worldMesh";
import { ice } from "./ice";
import { actBy } from "./processCatalogue";
import { streams } from "./streams";

/**
 * What a process meets on its way down through a cell. One tilted slope in one rock, run for one
 * pass, in about a second; each test compares two grounds under the same water or ice.
 */
function ground(rock: RockKind, prepare: (map: PhysicalField, i: number) => void = () => {}) {
  const map = createField(createWorldMesh([-600_000, -400_000, 600_000, 400_000], 3000, 25_000));
  for (let i = 0; i < map.mesh.count; i++) {
    const height = (map.mesh.x(i) + 600_000) * 0.02 + 20 * Math.sin(map.mesh.y(i) / 30_000);
    setLayer(map, i, 0, rock.code, units(30_000));
    map.RockKindCodes.set(i, rock.code);
    map.RockResistance.set(i, rock.resistance);
    map.BedrockElevation.set(i, units(height));
    map.DrainageElevations.set(i, units(height));
    map.Runoff.set(i, 1000);
    map.WaterKindCodes.set(i, height <= 0 ? 1 : 0);
    prepare(map, i);
    rebuild(map, i);
  }
  return map;
}
const landMean = (map: PhysicalField, value: (i: number) => number) => {
  let total = 0,
    cells = 0;
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes.get(i) === 0) {
      total += value(i);
      cells++;
    }
  return total / cells;
};
const context = () => physicalContext(1, 0, atlasPhysicalProfile(), null, 0, 1);
/** Metres of mean height a run takes off the land. */
function lowered(map: PhysicalField, run: (map: PhysicalField) => void) {
  const before = Float64Array.from({ length: map.mesh.count }, (_, i) => map.Elevation.get(i));
  run(map);
  return landMean(map, (i) => (before[i] - map.Elevation.get(i)) / 1024);
}
/** Metres of rock, as against loose cover, a run takes off the land. */
function rockLowered(map: PhysicalField, run: (map: PhysicalField) => void) {
  const before = Float64Array.from({ length: map.mesh.count }, (_, i) =>
    map.BedrockElevation.get(i)
  );
  run(map);
  return landMean(map, (i) => (before[i] - map.BedrockElevation.get(i)) / 1024);
}
const runStreams = (map: PhysicalField) => actBy(streams)(map, context());
/** A cell's ice sliding at 100 m a year, on down the slope. */
function underIce(map: PhysicalField, i: number) {
  const thickness = 500;
  map.IceThickness.set(i, thickness);
  map.IceFlux.set(i, 100 * thickness * map.mesh.spacing);
  map.GroundedIce.set(i, 1);
  map.IceFlowTargets.set(i, map.mesh.cellAt(map.mesh.x(i) - 50_000, map.mesh.y(i)));
}
const runIce = (map: PhysicalField) => actBy(ice)(map, context());

it("spends a river's power on sediment before the rock under it", () => {
  // A thin stream, whose power runs out in the cover: a strong one cuts through either.
  const thin = (map: PhysicalField, i: number) => map.Runoff.set(i, 5),
    bare = rockLowered(ground(rockCatalogue.quartzite, thin), runStreams),
    covered = rockLowered(
      ground(rockCatalogue.quartzite, (map, i) => {
        thin(map, i);
        map.SedimentThickness.set(i, units(2));
      }),
      runStreams
    );
  expect(covered).toBeLessThan(bare);
});
it("lets ice take loose cover faster than the rock beneath it", () => {
  const bare = lowered(ground(rockCatalogue.gneiss, underIce), runIce),
    covered = lowered(
      ground(rockCatalogue.gneiss, (map, i) => {
        underIce(map, i);
        map.SedimentThickness.set(i, units(500));
      }),
      runIce
    );
  expect(covered).toBeGreaterThan(1.5 * bare);
});
it("lets ice pluck jointed rock faster than massive rock of about the same strength", () => {
  const massive = lowered(ground(rockCatalogue.gneiss, underIce), runIce),
    jointed = lowered(ground(rockCatalogue.basalt, underIce), runIce);
  expect(rockCatalogue.basalt.resistance).toBeGreaterThan(rockCatalogue.gneiss.resistance);
  expect(jointed).toBeGreaterThan(massive);
});
it("lets a river cut fractured rock faster than the same rock intact", () => {
  const intact = lowered(ground(rockCatalogue.schist), runStreams),
    broken = lowered(
      ground(rockCatalogue.schist, (map, i) => map.FractureConductance.set(i, 1000)),
      runStreams
    );
  expect(broken).toBeGreaterThan(1.2 * intact);
});
it("holds warded ground against a river on the world map as on a region", () => {
  const open = lowered(ground(rockCatalogue.schist), runStreams),
    warded = lowered(
      ground(rockCatalogue.schist, (map, i) => map.Warding.set(i, 1)),
      runStreams
    );
  expect(warded).toBeLessThan(0.8 * open);
});
it("lets kept stone refuse wear that rock of its strength would give up", () => {
  const veinrock = lowered(ground(rockCatalogue.veinrock), runStreams),
    kept = lowered(ground(rockCatalogue.keptStone), runStreams);
  expect(rockCatalogue.keptStone.resistance).toBeLessThan(rockCatalogue.veinrock.resistance);
  expect(kept).toBeLessThan(veinrock / 2);
});
it("keeps every rock kind's stored code, so saved maps go on meaning the same rock", () => {
  expect(Object.values(rockCatalogue).map(({ id, code }) => [id, code])).toEqual(
    expect.arrayContaining(
      [
        "strata",
        "shale",
        "sandstone",
        "limestone",
        "saltbed",
        "slate",
        "schist",
        "marble",
        "quartzite",
        "gneiss",
        "granite",
        "basalt",
        "tuff",
        "impactite",
        "veinrock",
        "sinter",
        "corefall",
        "rimerot",
        "auroraCrystal",
        "crushstone",
        "rootstone",
        "tufa",
        "saltGlass",
        "keptStone",
        "tornstone",
      ].map((id, code) => [id, code])
    )
  );
});
