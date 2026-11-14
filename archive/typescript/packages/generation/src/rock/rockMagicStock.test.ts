import { expect, it } from "vitest";
import { magicSystemSchema, MapScale, resolveMagicSystem } from "@atlas/domain";
import { createTestField } from "./groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { groundOf } from "./ground";
import { constructRock, deposit } from "./groundLedger";
import {
  depositFallenCores,
  depositSaltBed,
  stockExposure,
  stockSurfaceReader,
  withdrawStockHost,
  mineralStockDepth,
  originBurialDepth,
  exposedReservoirAmount,
} from "./rockMagicStock";
import { rockCatalogue as rocks } from "./rockCatalogue";
import { units } from "../world/math";
import { MaterialLoad } from "./groundLoad";
import { materialLayer } from "./rockColumn";
import { openCut } from "./groundShares";
import { GroundInventory } from "./groundInventory";

it("deposits new Salt material above retained ground without relocating an older buried bed", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    bed = new GroundInventory(map, "salt:test/bed"),
    amount = map.mesh.area(0) * 1000,
    ground = groundOf(map);
  map.CompletedEpochCount = 2;
  depositSaltBed(map, bed, 0, amount, 1000);
  constructRock(map, 0, units(300), rocks.basalt, "test", "melt");
  expect(
    ground
      .section(0)
      .slice(0, 2)
      .map((layer) => layer.kind)
  ).toEqual([rocks.basalt.code, rocks.saltbed.code]);
  expect(stockExposure(map, 0, 100, [rocks.saltbed.code])).toBe(0);
  map.CompletedEpochCount = 4;
  depositSaltBed(map, bed, 0, amount / 10, 1000);
  const section = ground.section(0);
  expect(section.slice(0, 3).map((layer) => layer.kind)).toEqual([
    rocks.saltbed.code,
    rocks.basalt.code,
    rocks.saltbed.code,
  ]);
  expect(section[0].formedMin).toBe(4);
  expect(section[2].formedMin).toBe(2);
  // Fresh exposed material does not make the older buried inventory accessible.
  expect(stockExposure(map, 0, 100, [rocks.saltbed.code])).toBeCloseTo(1 / 11);
});

it("places fallen cores on hard substrate independently of heat or a later magic evaluation", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    held = new GroundInventory(map, "fire:test/held"),
    ground = groundOf(map);
  constructRock(map, 0, units(300), rocks.quartzite, "test", "space");
  depositFallenCores(map, held, 0, map.mesh.area(0) * 400 * 20, 400);
  expect(
    ground
      .section(0)
      .slice(0, 2)
      .map((layer) => layer.kind)
  ).toEqual([rocks.corefall.code, rocks.quartzite.code]);
  expect(stockExposure(map, 0, 100, [rocks.corefall.code])).toBe(1);
  constructRock(map, 0, units(300), rocks.basalt, "test", "melt");
  expect(stockExposure(map, 0, 100, [rocks.corefall.code])).toBe(0);
});

it("projects only accessible stock for surface rules while retaining the buried inventory", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    bed = new GroundInventory(map, "salt:basin/crust"),
    definition = resolveMagicSystem(
      magicSystemSchema.parse({
        id: "salt",
        name: "Salt",
        phase: "post-glacial",
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
    ),
    field = { definition, stocks: { "basin/crust": bed } },
    read = stockSurfaceReader(map, field, "basin/crust"),
    amount = (map.mesh.area(0) * definition.parameters.saltFull) / 10;
  depositSaltBed(map, bed, 0, amount, definition.parameters.saltMaterialDensity);
  expect(read(0)).toBe(amount);
  constructRock(map, 0, units(300), rocks.basalt, "test", "melt");
  expect(read(0)).toBe(0);
  expect(bed.get(0)).toBe(amount);
  expect(stockSurfaceReader(map, field, "absent")(0)).toBe(0);
});

it("converts a lake inventory by material density independently of map size and field saturation", () => {
  for (const span of [2_000_000, 4_000_000, 8_000_000])
    for (const saltFull of [100, 10_000]) {
      const scale = new MapScale(span, span * 0.75, span / 100),
        definition = resolveMagicSystem(
          magicSystemSchema.parse({
            id: "salt",
            name: "Salt",
            phase: "post-glacial",
            origins: [{ id: "basin", source: "dead-lake", propagation: "brine" }],
            parameters: { saltFull },
          }),
          scale
        ),
        p = definition.parameters,
        area = scale.area(0.001),
        waterDepth = 100,
        amount = waterDepth * area * p.saltPerLakeMetre;
      expect(mineralStockDepth(amount, area, p.saltMaterialDensity)).toBe(units(2));
    }
});

it("reads and releases each origin through its own burial depth on the same supplied column", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    definition = resolveMagicSystem(
      magicSystemSchema.parse({
        id: "salt",
        name: "Salt",
        phase: "post-glacial",
        origins: [
          {
            id: "shallow",
            source: "placed",
            propagation: "local",
            parameters: { buryDepth: 0.000001 },
            stocks: [{ id: "bed", reservoir: "bed", carriers: ["crust"] }],
          },
          {
            id: "deep",
            source: "placed",
            propagation: "local",
            parameters: { buryDepth: 0.0001 },
            stocks: [{ id: "bed", reservoir: "bed", carriers: ["crust"] }],
          },
          { id: "default", source: "placed", propagation: "local" },
        ],
      }),
      map.scale
    ),
    shallow = new GroundInventory(map, "salt:shallow/bed"),
    deep = new GroundInventory(map, "salt:deep/bed"),
    amount = map.mesh.area(0) * 1000,
    field = { definition, stocks: { "shallow/bed": shallow, "deep/bed": deep, orphan: deep } };
  depositSaltBed(map, shallow, 0, amount, 1000);
  depositSaltBed(map, deep, 0, amount, 1000);
  constructRock(map, 0, units(100), rocks.basalt, "test", "melt");
  expect(originBurialDepth(field, definition.origins[2])).toBe(definition.parameters.buryDepth);
  expect(stockSurfaceReader(map, field, "shallow/bed")(0)).toBe(0);
  expect(stockSurfaceReader(map, field, "deep/bed")(0)).toBeCloseTo(amount);
  expect(exposedReservoirAmount(map, field, "bed", 0)).toBeCloseTo(amount);
  expect(stockSurfaceReader(map, field, "orphan")(0)).toBe(0);
  expect(shallow.get(0)).toBeCloseTo(amount);
  expect(shallow.release(0, units(originBurialDepth(field, definition.origins[0])), () => 1)).toBe(
    0
  );
  expect(
    deep.release(0, units(originBurialDepth(field, definition.origins[1])), () => 1)
  ).toBeGreaterThan(0);
  expect(shallow.get(0)).toBeCloseTo(amount);
});

it("routes actual loose host clasts to new ground while retaining the intact bed", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    ground = groundOf(map),
    cargo = new MaterialLoad(map, "test:host-cargo"),
    hosts = [rocks.corefall.code];
  constructRock(map, 0, units(6), rocks.corefall, "test", "space");
  expect(
    withdrawStockHost(map, 0, hosts, 1, () => {
      throw new Error("Intact cores cannot be carried as loose placers");
    })
  ).toBe(0);
  deposit(
    map,
    0,
    units(4),
    "test",
    "space",
    materialLayer(rocks.corefall.code, units(4), { formedMin: 2, formedMax: 2, altered: 3 })
  );
  const fraction = withdrawStockHost(map, 0, hosts, 0.5, (material) => {
    cargo.add(1, {
      ...material,
      depth: MapScale.metres(material.depth, "native") * map.mesh.area(0),
    });
  });
  expect(fraction).toBeCloseTo(0.2);
  const parcel = cargo.get(1),
    depth = MapScale.inUnits(parcel.depth / map.mesh.area(1), "native");
  deposit(map, 1, depth, "test", "load", { ...parcel, depth });
  expect(ground.section(1)[0]).toMatchObject({
    medium: "loose",
    kind: rocks.corefall.code,
    formedMin: 2,
    altered: 3,
  });
  expect(stockExposure(map, 1, 100, hosts)).toBe(1);
  expect(ground.section(0).find((layer) => layer.medium === "rock")).toMatchObject({
    kind: rocks.corefall.code,
    depth: units(6),
  });
  cargo.release();
});

it("withdraws the shared soil skin across both loose host facets", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  openCut(map, 0, 0.2);
  deposit(map, 0, units(4), "test", "space", materialLayer(rocks.corefall.code, units(4)));
  map.SoilDepth.set(0, 1);
  withdrawStockHost(map, 0, [rocks.corefall.code], 0.5, () => {});
  expect(map.SoilDepth.get(0)).toBe(0);
});
