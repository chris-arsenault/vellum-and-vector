import { expect, it } from "vitest";
import { createTestField as createField } from "./groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { units } from "../world/math";
import { groundOf } from "./ground";
import { constructMaterial } from "./groundConstruction";
import {
  constructRock,
  deposit,
  erodeFacets,
  lithifyBuried,
  removeRock,
  standGround,
} from "./groundLedger";
import { openCut } from "./groundShares";
import { accreteHeldGround, holdRock, releaseHeldRock } from "./groundTransport";
import { compileMix } from "./modes";
import { materialLayer, readLayer, setLayer, type MaterialLayer } from "./rockColumn";
import { rockCatalogue as rocks } from "./rockCatalogue";

const sourceFacts = {
  secondaryKind: rocks.shale.code,
  secondaryShare: 0.25,
  mixed: 1,
  strength: 1800,
  damage: 0.6,
  grainX: 600,
  grainY: 800,
  formedMin: 1,
  formedMax: 3,
};
const abrasion = compileMix({ abrasion: 1 });
function suppliedGround() {
  const map = createField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  for (const cell of [0, 1, 2]) {
    setLayer(map, cell, 0, rocks.granite.code, units(30_000));
    standGround(map, cell, units(500), "supplied placement");
  }
  map.CompletedEpochCount = 4;
  for (const cell of [1, 2])
    deposit(
      map,
      cell,
      units(100),
      "routed sediment",
      "load",
      materialLayer(rocks.sandstone.code, units(100), sourceFacts)
    );
  return map;
}
function capDeposits(map: ReturnType<typeof suppliedGround>, mechanism: string) {
  if (mechanism === "emplacement") {
    for (const cell of [1, 2])
      constructRock(map, cell, units(1200), rocks.basalt, "solid cap", "crust");
    return;
  }
  constructRock(map, 0, units(1200), rocks.basalt, "donor package", "crust");
  const held = holdRock(map);
  try {
    for (const cell of [1, 2]) accreteHeldGround(map, held, cell, 0, units(1200));
  } finally {
    releaseHeldRock(map, held);
  }
}

it.each(["emplacement", "collision"])(
  "consolidates an entombed deposit after %s and changes its later exposed wear",
  (mechanism) => {
    const map = suppliedGround(),
      ground = groundOf(map);
    capDeposits(map, mechanism);
    const cap = readLayer(map, 1, 0),
      elevation = map.Elevation.get(1),
      placement = map.BedrockElevation.get(1);
    expect(readLayer(map, 1, 1)).toMatchObject({ ...sourceFacts, consolidation: 0, deposited: 4 });
    map.CompletedEpochCount = 7;
    lithifyBuried(map, 1, units(1000), 0.5, "burial");
    const buried = readLayer(map, 1, 1);
    expect(buried).toMatchObject({
      ...sourceFacts,
      kind: rocks.sandstone.code,
      damage: expect.closeTo(0.45),
      consolidation: 0.325,
      altered: 7,
      deposited: 4,
    });
    expect(readLayer(map, 1, 0)).toEqual(cap);
    expect(map.Elevation.get(1)).toBe(elevation);
    expect(map.BedrockElevation.get(1)).toBe(placement);
    for (const cell of [1, 2]) removeRock(map, cell, cap.depth, "later cap stripping");
    const depths = ground.surfaceAction(1, abrasion, 1, units(20)),
      uncemented = ground.surfaceAction(2, abrasion, 1, units(20)),
      worn: MaterialLayer[] = [];
    expect(depths[0]).toBeGreaterThan(0);
    expect(depths[0]).toBeLessThan(uncemented[0]);
    erodeFacets(map, 1, depths, "later abrasion", "load", (parcel) => worn.push(parcel));
    expect(worn[0]).toMatchObject({
      ...sourceFacts,
      damage: expect.closeTo(0.45),
      consolidation: 0.325,
      altered: 7,
      deposited: 4,
    });
    expect(readLayer(map, 1, 0).depth).toBeLessThan(buried.depth);
  }
);

it("averages only the buried part of each occupied bed and leaves shallow or cemented material alone", () => {
  const map = suppliedGround();
  openCut(map, 1, 0.25);
  constructMaterial(map, 1, materialLayer(rocks.basalt.code, units(950)), "cap", "crust", "land");
  constructMaterial(map, 1, materialLayer(rocks.basalt.code, units(600)), "cap", "crust", "cut");
  const landCap = readLayer(map, 1, 0),
    cutCap = readLayer(map, 1, 0, "cut"),
    cutDeposit = readLayer(map, 1, 1, "cut"),
    untouched = readLayer(map, 2, 0, "loose"),
    elevation = map.Elevation.get(1);
  lithifyBuried(map, 1, units(1000), 0.5, "burial");
  lithifyBuried(map, 2, units(1000), 0.5, "burial");
  expect(readLayer(map, 1, 1).consolidation).toBeCloseTo(0.1625);
  expect(readLayer(map, 1, 1, "cut")).toEqual(cutDeposit);
  expect(readLayer(map, 1, 0)).toEqual(landCap);
  expect(readLayer(map, 1, 0, "cut")).toEqual(cutCap);
  expect(readLayer(map, 2, 0, "loose")).toEqual(untouched);
  expect(map.Elevation.get(1)).toBe(elevation);
  // Further overburden engages the whole bed. Once cemented, later burial does not age it again.
  constructMaterial(map, 1, materialLayer(rocks.basalt.code, units(100)), "cap", "crust", "land");
  lithifyBuried(map, 1, units(1000), 1, "burial");
  const cemented = groundOf(map)
    .section(1)
    .find((layer) => layer.kind === rocks.sandstone.code);
  expect(cemented?.consolidation).toBe(0.65);
  map.CompletedEpochCount = 12;
  lithifyBuried(map, 1, units(1000), 0.5, "burial");
  expect(
    groundOf(map)
      .section(1)
      .find((layer) => layer.kind === rocks.sandstone.code)
  ).toEqual(cemented);
});

it("retains the unconverted constituent when an entombed loose material consolidates gradually", () => {
  const map = suppliedGround();
  deposit(
    map,
    0,
    units(100),
    "routed sediment",
    "load",
    materialLayer(rocks.alluvium.code, units(100), { formedMin: 2, formedMax: 3, grainX: 600 })
  );
  constructRock(map, 0, units(1200), rocks.basalt, "solid cap", "crust");
  map.CompletedEpochCount = 7;
  lithifyBuried(map, 0, units(1000), 0.5, "burial");
  const bed = readLayer(map, 0, 1);
  expect([bed.kind, bed.secondaryKind]).toContain(rocks.alluvium.code);
  expect([bed.kind, bed.secondaryKind]).toContain(rocks.sandstone.code);
  expect(bed).toMatchObject({
    secondaryShare: 0.5,
    formedMin: 2,
    formedMax: 3,
    grainX: 600,
    deposited: 4,
    altered: 7,
    consolidation: 0.325,
  });
});
