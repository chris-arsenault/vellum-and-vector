import { expect, it } from "vitest";
import { magicSystemSchema, resolveMagicSystem } from "@atlas/domain";
import type { GenerationState } from "./process";
import { carriedSolid, gatherSolid, tradeSolid, useSolid } from "./societyMaterials";
import { createTestField } from "./rock/groundTestFixture";
import { createWorldMesh } from "./world/worldMesh";
import { GroundInventory } from "./rock/groundInventory";
import { materialLayer, setLayer } from "./rock/rockColumn";
import { constructMaterial } from "./rock/groundConstruction";
import { groundOf } from "./rock/ground";
import { rockCatalogue as rocks } from "./rock/rockCatalogue";
import { units } from "./world/math";
import { removeLoose, deposit } from "./rock/groundLedger";

function suppliedParcels() {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  const definition = resolveMagicSystem(
    magicSystemSchema.parse({
      id: "salt",
      name: "Salt",
      phase: "post-glacial",
      effects: { salting: 1 },
      parameters: { buryDepth: 0.01 },
      origins: [
        {
          id: "basin",
          source: "placed",
          propagation: "local",
          stocks: [{ id: "crust", reservoir: "bed", carriers: ["crust"] }],
        },
      ],
    }),
    map.scale
  );
  const bed = new GroundInventory(map, "salt:basin/crust");
  setLayer(map, 0, 0, rocks.granite.code, 1);
  setLayer(map, 1, 0, rocks.granite.code, 1);
  setLayer(
    map,
    0,
    0,
    rocks.saltbed.code,
    units(2),
    {
      formedMin: 2,
      formedMax: 2,
      cargo: new Float64Array([bed.key, rocks.saltbed.code, 10]),
    },
    "loose"
  );
  const state = {
    domain: { world: { magicSystems: [definition] } },
    physical: {
      map,
      samples: { get: (i: number) => i },
      magic: { fields: [{ definition, stocks: { "basin/crust": bed } }] },
    },
  } as unknown as GenerationState;
  return { state, map, bed, amount: map.mesh.area(0) * 5 };
}

it("surface gathering cannot reach old grains beneath uncharged cover", () => {
  const { state, map, bed, amount } = suppliedParcels();
  constructMaterial(map, 0, materialLayer(rocks.saltbed.code, units(3)), "test", "space");
  expect(gatherSolid(state, "salts", "bed", "a", 0, amount, true)).toBe(0);
  expect(carriedSolid(state, "salts", "a", 0)).toBe(0);
  expect(bed.get(0)).toBeGreaterThan(amount);
});

it("trade carries the worked material and its age; use releases only the delivered stock", () => {
  const { state, map, bed, amount } = suppliedParcels();
  expect(gatherSolid(state, "salts", "bed", "a", 0, amount, true)).toBeCloseTo(amount);
  expect(carriedSolid(state, "salts", "a", 0)).toBeCloseTo(amount);
  expect(tradeSolid(state, "salts", "a", "b", 0, 1, amount)).toBeCloseTo(amount);
  expect(carriedSolid(state, "salts", "a", 0)).toBe(0);
  expect(carriedSolid(state, "salts", "b", 1)).toBeCloseTo(amount);
  expect(bed.get(1)).toBe(0);
  expect(groundOf(map).section(1)).toContainEqual(
    expect.objectContaining({
      kind: rocks.saltbed.code,
      formedMin: 2,
    })
  );
  expect(useSolid(state, "salts", "b", 1, amount * 2)).toBeCloseTo(amount);
  expect(bed.get(1)).toBeCloseTo(amount);
  expect(useSolid(state, "salts", "b", 1, amount)).toBe(0);
});
it("natural removal ends custody and makes transported grains available in their original reservoir", () => {
  const { state, map, bed, amount } = suppliedParcels();
  gatherSolid(state, "salts", "bed", "a", 0, amount, true);
  tradeSolid(state, "salts", "a", "b", 0, 1, amount);
  removeLoose(map, 1, units(3), "test erosion", (parcel) => {
    const depth = (parcel.depth * map.mesh.area(1)) / map.mesh.area(2);
    deposit(map, 2, depth, "test deposition", "load", { ...parcel, depth });
  });
  expect(carriedSolid(state, "salts", "b", 1)).toBe(0);
  expect(bed.get(2)).toBeCloseTo(amount);
  expect(groundOf(map).section(2)).toContainEqual(
    expect.objectContaining({ kind: rocks.saltbed.code, formedMin: 2 })
  );
});
