import { expect, it } from "vitest";
import { MapScale } from "@atlas/domain";
import { createTestField } from "./groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { units } from "../world/math";
import { groundOf } from "./ground";
import { constructMaterial, constructRock, deposit, extractGround } from "./groundLedger";
import { extractConstituent, extractableDepth, extractReached } from "./groundExtraction";
import { materialLayer, type MaterialLayer } from "./rockColumn";
import { rockCatalogue as rocks } from "./rockCatalogue";
import { openCut } from "./groundShares";
import { loadOf, MaterialLoad } from "./groundLoad";

const field = () => createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
const salt = rocks.saltbed.code;

it("separates either constituent while preserving the surviving bed's recorded state", () => {
  const mixed = materialLayer(salt, units(10), {
    secondaryKind: rocks.limestone.code,
    secondaryShare: 0.5,
    formedMin: 2,
    formedMax: 4,
    altered: 6,
    damage: 0.3,
    bedSlopeX: 0.1,
  });
  expect(extractConstituent(mixed, salt, units(5)).remaining).toMatchObject({
    kind: rocks.limestone.code,
    depth: units(5),
    secondaryShare: 0,
    formedMin: 2,
    formedMax: 4,
    altered: 6,
    damage: 0.3,
    bedSlopeX: 0.1,
  });
  expect(extractConstituent(mixed, rocks.limestone.code, units(5)).remaining).toMatchObject({
    kind: salt,
    depth: units(5),
    secondaryShare: 0,
    altered: 6,
  });
});

it("leaves the unreached portion of a mixed bed unchanged", () => {
  const mixed = materialLayer(salt, units(10), {
    secondaryKind: rocks.limestone.code,
    secondaryShare: 0.5,
    formedMin: 2,
    altered: 4,
  });
  expect(extractReached(mixed, salt, units(20), units(2)).layers).toEqual([
    { ...mixed, kind: rocks.limestone.code, secondaryShare: 0, depth: units(1) },
    { ...mixed, depth: units(8) },
  ]);
});

it("keeps the numerical basement marker out of both inventory and withdrawal", () => {
  const marker = materialLayer(salt, 1);
  expect(extractableDepth(marker, true)).toBe(0);
  expect(extractReached(marker, salt, units(20), Infinity, true)).toMatchObject({
    removed: 0,
    layers: [marker],
  });
});

it("dissolves a reached seam beneath its intact cap and keeps original deeper contacts out of reach", () => {
  const map = field(),
    ground = groundOf(map);
  constructRock(map, 0, units(4), rocks.saltbed, "test", "space");
  constructRock(map, 0, units(2), rocks.basalt, "test", "space");
  map.CompletedEpochCount = 4;
  constructRock(map, 0, units(1), rocks.saltbed, "test", "space");
  constructRock(map, 0, units(1), rocks.quartzite, "test", "space");
  const cap = ground.section(0)[0],
    elevation = map.Elevation.get(0);
  extractGround(map, 0, { kind: salt, amount: units(20), reach: units(4) }, "test");
  expect(
    ground
      .section(0)
      .slice(0, 3)
      .map((layer) => layer.kind)
  ).toEqual([rocks.quartzite.code, rocks.basalt.code, salt]);
  expect(ground.section(0)[0]).toMatchObject({ depth: cap.depth, formedMin: cap.formedMin });
  expect(map.Elevation.get(0)).toBe(elevation - units(1));
  expect(ground.section(0)[2].depth).toBe(units(4));
  expect(loadOf(map).get(0)).toMatchObject({ kind: salt, formedMin: 4 });
});

it("surface wind cannot extract Salt through either solid or loose non-Salt cover", () => {
  for (const loose of [false, true]) {
    const map = field();
    constructRock(map, 0, units(4), rocks.saltbed, "test", "space");
    if (loose)
      deposit(map, 0, units(1), "test", "space", materialLayer(rocks.basalt.code, units(1)));
    else constructRock(map, 0, units(1), rocks.basalt, "test", "space");
    expect(
      extractGround(
        map,
        0,
        {
          kind: salt,
          amount: units(20),
          reach: Infinity,
          surfaceOnly: true,
        },
        "test"
      )
    ).toBe(0);
  }
});

it("retains the reached contact when a full column needs room for an extraction split", () => {
  const map = field(),
    ground = groundOf(map);
  for (let bed = 0; bed < 7; bed++)
    constructRock(map, 0, units(10), bed % 2 ? rocks.basalt : rocks.quartzite, "test", "space");
  constructMaterial(
    map,
    0,
    materialLayer(salt, units(10), {
      secondaryKind: rocks.limestone.code,
      secondaryShare: 0.5,
      formedMin: 2,
      altered: 4,
    }),
    "test",
    "space"
  );
  expect(ground.section(0)).toHaveLength(8);
  extractGround(map, 0, { kind: salt, amount: units(1), reach: units(2) }, "test");
  const section = ground.section(0);
  expect(section).toHaveLength(8);
  expect(section[0]).toMatchObject({ kind: rocks.limestone.code, depth: units(1), altered: 4 });
  expect(section[1]).toMatchObject({
    mixed: 1,
    altered: 4,
  });
});

it("carries exposed grains from both facets with their history and removes the shared skin once", () => {
  const map = field(),
    cargo = new MaterialLoad(map, "test:salt-grains"),
    receipts: MaterialLayer[] = [];
  openCut(map, 0, 0.2);
  deposit(
    map,
    0,
    units(4),
    "test",
    "space",
    materialLayer(salt, units(4), { formedMin: 2, altered: 3 })
  );
  map.SoilDepth.set(0, 1);
  extractGround(
    map,
    0,
    { kind: salt, amount: units(4), reach: Infinity, surfaceOnly: true, looseOnly: true },
    "test",
    "load",
    (material) => {
      receipts.push(material);
      cargo.add(1, {
        ...material,
        depth: MapScale.metres(material.depth, "native") * map.mesh.area(0),
      });
    }
  );
  expect(receipts).toHaveLength(2);
  expect(receipts[0].depth).toBeCloseTo(units(4) * 0.8);
  expect(receipts[1].depth).toBeCloseTo(units(4) * 0.2);
  expect(map.SoilDepth.get(0)).toBe(0);
  const parcel = cargo.get(1),
    depth = MapScale.inUnits(parcel.depth / map.mesh.area(1), "native");
  deposit(map, 1, depth, "test", "load", { ...parcel, depth });
  expect(groundOf(map).section(1)[0]).toMatchObject({
    kind: salt,
    medium: "loose",
    formedMin: 2,
    altered: 3,
  });
  cargo.release();
});
