import { expect, it } from "vitest";
import {
  createTestField as createField,
  type TestPhysicalField as PhysicalField,
} from "./groundTestFixture";
import { units } from "../world/math";
import { projectGround as rebuild } from "./groundShares";
import { createWorldMesh } from "../world/worldMesh";
import { groundOf, type GroundQuery } from "./ground";
import { compileMix } from "./modes";
import { setLayer } from "./rockColumn";
import { rockCatalogue } from "./rockCatalogue";
import { deposit } from "./groundLedger";
import { setRockStrength } from "./rockField";

const { shale, quartzite, gneiss } = rockCatalogue,
  grinding = compileMix({ abrasion: 1 });
function column(prepare: (map: PhysicalField) => void) {
  const map = createField(createWorldMesh([-50_000, -50_000, 50_000, 50_000], 40, 25_000));
  map.RockKindCodes.set(0, shale.code);
  map.RockResistance.set(0, shale.resistance);
  setLayer(map, 0, 0, shale.code, units(30_000));
  prepare(map);
  rebuild(map, 0);
  return map;
}
it("spends an action on sediment, then rock, by what each gives up", () => {
  const bare = column(() => {}),
    covered = column((map) => deposit(map, 0, units(1), "test"));
  const bareDepth = groundOf(bare).actOn(0, grinding, 1, Infinity) / 1024,
    coveredDepth = groundOf(covered).actOn(0, grinding, 1, Infinity) / 1024;
  // Alluvium gives 1000/300 and takes 0.3 of the power for its metre; shale takes the rest at 1000/600.
  expect(bareDepth).toBeCloseTo(1 * (1000 / 600), 1);
  expect(coveredDepth).toBeCloseTo(1 + 0.7 * (1000 / 600), 1);
});
it("goes on down through a layer it cuts through, at the next layer's rate", () => {
  const map = column((m) => {
    setLayer(m, 0, 0, shale.code, units(1));
    setLayer(m, 0, 1, quartzite.code, units(30_000));
  });
  const depth = groundOf(map).actOn(0, grinding, 1, Infinity) / 1024,
    powerLeft = 1 - 1 / (1000 / 600);
  expect(depth).toBeCloseTo(1 + powerLeft * (1000 / 3500), 1);
});
it("stops at the limit it is given", () => {
  expect(groundOf(column(() => {})).actOn(0, grinding, 100, units(3))).toBe(units(3));
});
it("carries what has been done to the surface, not only what kind it is", () => {
  const hardened = column((map) => setRockStrength(map, 0, 2000));
  expect(groundOf(hardened).gives(0, grinding)).toBeCloseTo(0.5);
});
it("lets a map stiffen its own ground for everything that acts on it", () => {
  const map = column(() => {}),
    ground = groundOf(map),
    plain = ground.gives(0, grinding);
  ground.stiffenBy(() => 2);
  expect(ground.gives(0, grinding)).toBeCloseTo(plain / 2);
});
it("lets a query walk the column below the surface, without knowing about it in advance", () => {
  const map = column((m) => {
    setLayer(m, 0, 0, shale.code, units(10));
    setLayer(m, 0, 1, gneiss.code, units(30_000));
  });
  const kinds: GroundQuery<readonly string[]> = {
    start: [],
    throughColumn: true,
    rock: (sofar, { kind }) => [...sofar, kind.id],
  };
  expect(groundOf(map).fold(0, kinds)).toEqual(["shale", "gneiss"]);
  const surface: GroundQuery<string> = { start: "", rock: (_, { kind }) => kind.id };
  expect(groundOf(map).fold(0, surface)).toBe("shale");
});
