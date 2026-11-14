import { expect, it } from "vitest";
import { groundOf } from "../rock/ground";
import { createTestField } from "../rock/groundTestFixture";
import { standGround } from "../rock/groundLedger";
import { MaterialLoad, seaLoadOf } from "../rock/groundLoad";
import { cargoIdentity } from "../rock/groundCargoIdentity";
import { materialLayer, readLayer } from "../rock/rockColumn";
import { rockCatalogue as rocks } from "../rock/rockCatalogue";
import { settleAtSea } from "./fluvial";
import { units } from "./math";
import { createWorldMesh } from "./worldMesh";

/** Explicit delivered material, not a simulated river or fixture-world generation. */
function suppliedMouth(depth = 20) {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    cell = 0,
    moving = new MaterialLoad(map, "test:mouth-delivery"),
    cargo = new Float64Array([cargoIdentity(map, "supplied-charge"), rocks.sandstone.code, 4]);
  map.CompletedEpochCount = 9;
  map.EffectiveSeaLevel = 0;
  map.WaterKindCodes.set(cell, 1);
  standGround(map, cell, units(-depth), "supplied seabed");
  moving.add(
    cell,
    materialLayer(rocks.sandstone.code, 6 * map.mesh.area(cell), {
      secondaryKind: rocks.shale.code,
      secondaryShare: 0.25,
      formedMin: 2,
      formedMax: 5,
      altered: 7,
      grainX: 600,
      grainY: 800,
      cargo,
    })
  );
  return { map, cell, moving, cargo };
}

it("settles delivered river sediment through Ground with its constituents, history and hosted cargo", () => {
  const { map, cell, moving, cargo } = suppliedMouth(),
    before = groundOf(map).surface(cell, "land");
  try {
    settleAtSea(map, cell, moving);
    expect(groundOf(map).surface(cell, "land")).toBeGreaterThan(before);
    expect(readLayer(map, cell, 0, "loose")).toMatchObject({
      kind: rocks.sandstone.code,
      secondaryKind: rocks.shale.code,
      secondaryShare: 0.25,
      formedMin: 2,
      formedMax: 5,
      altered: 7,
      deposited: 9,
      consolidation: 0,
      grainX: 600,
      grainY: 800,
      cargo,
    });
    expect(moving.amount(cell)).toBe(0);
    expect(seaLoadOf(map).amount(cell)).toBe(0);
  } finally {
    moving.release();
  }
});

it("fills the actual submerged room and passes excess material with its cargo to marine transport", () => {
  const { map, cell, moving, cargo } = suppliedMouth(2);
  try {
    settleAtSea(map, cell, moving);
    expect(groundOf(map).surface(cell, "land")).toBe(map.EffectiveSeaLevel);
    expect(readLayer(map, cell, 0, "loose").kind).toBe(rocks.sandstone.code);
    expect(seaLoadOf(map).amount(cell)).toBeGreaterThan(0);
    expect(seaLoadOf(map).get(cell)).toMatchObject({
      kind: rocks.sandstone.code,
      formedMin: 2,
      cargo,
    });
    expect(moving.amount(cell)).toBe(0);
  } finally {
    moving.release();
  }
});

it.each(["WaveExposure", "OceanCurrentStrength"] as const)(
  "lets %s carry the supplied material offshore without depositing it at the mouth",
  (forcing) => {
    const { map, cell, moving, cargo } = suppliedMouth(),
      before = groundOf(map).surface(cell, "land");
    map[forcing].set(cell, 1000);
    try {
      settleAtSea(map, cell, moving);
      expect(groundOf(map).surface(cell, "land")).toBe(before);
      expect(seaLoadOf(map).get(cell)).toMatchObject({ kind: rocks.sandstone.code, cargo });
      expect(seaLoadOf(map).amount(cell)).toBeGreaterThan(0);
      expect(moving.amount(cell)).toBe(0);
    } finally {
      moving.release();
    }
  }
);
