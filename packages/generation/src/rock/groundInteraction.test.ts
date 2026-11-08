import { expect, it } from "vitest";
import { Stage } from "../coupling/stage";
import { createTestField as createField } from "./groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { units } from "../world/math";
import { groundOf } from "./ground";
import { erodeFacets, lithify, removeLoose, removeRock, standGround } from "./groundLedger";
import { projectGround } from "./groundShares";
import { accreteHeldGround, holdRock, releaseHeldRock } from "./groundTransport";
import { compileMix } from "./modes";
import { readLayer, setLayer, type MaterialLayer } from "./rockColumn";
import { rockCatalogue as rocks } from "./rockCatalogue";

const solution = compileMix({ solution: 1 });
const inherited = {
  secondaryKind: rocks.shale.code,
  secondaryShare: 0.25,
  mixed: 1,
  strength: 1600,
  damage: 0.6,
  grainX: 600,
  grainY: 800,
  formedMin: 2,
  formedMax: 5,
  altered: 7,
};
function suppliedGround() {
  const map = createField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  for (const cell of [0, 1, 2]) {
    setLayer(map, cell, 0, rocks.granite.code, 1, { formedMin: 0, formedMax: 0 });
    standGround(map, cell, units(500), "supplied placement");
  }
  return map;
}

it("carries the same worn parcel through routing, burial and exposure into its next material response", () => {
  const map = suppliedGround(),
    owner = groundOf(map);
  setLayer(map, 0, 0, rocks.limestone.code, units(4), inherited);
  setLayer(map, 0, 1, rocks.granite.code, 1);
  projectGround(map, 0);
  const destinationBefore = owner.actOn(1, solution, 1, Infinity),
    stage = new Stage(map, { simultaneous: true });
  stage.moveSurface(0, 1, 4 * map.mesh.area(0), "routed wear");
  stage.settle();
  expect(readLayer(map, 0, 0).kind).toBe(rocks.granite.code);
  expect(readLayer(map, 1, 0, "loose")).toMatchObject({ kind: rocks.limestone.code, ...inherited });
  // Consolidation works on the older, buried part; the rest still covers it until later removal.
  map.CompletedEpochCount = 9;
  lithify(map, 1, units(3), "burial");
  expect(owner.section(1).map(({ medium }) => medium)).toEqual(["loose", "rock", "rock"]);
  const buried = readLayer(map, 1, 0);
  expect(buried).toMatchObject({
    kind: rocks.limestone.code,
    secondaryKind: rocks.shale.code,
    secondaryShare: 0.25,
    formedMin: 2,
    formedMax: 5,
    altered: 9,
    grainX: 600,
    grainY: 800,
    damage: 0.3,
  });
  removeLoose(map, 1, readLayer(map, 1, 0, "loose").depth, "later stripping");
  expect(owner.section(1)[0].medium).toBe("rock");
  const depths = owner.surfaceAction(1, solution, 1, Infinity);
  expect(destinationBefore).toBe(0);
  expect(depths[0]).toBeGreaterThan(destinationBefore);
  expect(depths[0]).toBeLessThan(buried.depth);
  // Retain this action's receipt separately from the earlier stripped loose cover.
  const removed: MaterialLayer[] = [];
  erodeFacets(map, 1, depths, "later solution", "load", (parcel) => removed.push(parcel));
  expect(removed[0]).toMatchObject({
    kind: rocks.limestone.code,
    secondaryKind: rocks.shale.code,
    secondaryShare: 0.25,
    formedMin: 2,
    formedMax: 5,
    altered: 9,
    damage: 0.3,
    grainX: 600,
    grainY: 800,
  });
  expect(removed[0].depth).toBeGreaterThan(0);
  expect(readLayer(map, 1, 0).depth).toBeLessThan(buried.depth);
});

it("makes a moved package block and then admit the same action when its inherited contact is exposed", () => {
  const map = suppliedGround(),
    owner = groundOf(map);
  setLayer(map, 0, 0, rocks.quartzite.code, units(1), {
    strength: 3800,
    formedMin: 8,
    altered: 10,
  });
  setLayer(map, 0, 1, rocks.limestone.code, units(10), inherited);
  setLayer(map, 0, 2, rocks.granite.code, 1);
  projectGround(map, 0);
  const held = holdRock(map);
  try {
    accreteHeldGround(map, held, 1, 0, units(4));
  } finally {
    releaseHeldRock(map, held);
  }
  expect(owner.actOn(1, solution, 1, Infinity)).toBe(0);
  removeRock(map, 1, units(1), "cap removal");
  expect(readLayer(map, 1, 0)).toMatchObject({ kind: rocks.limestone.code, ...inherited });
  expect(owner.actOn(0, solution, 1, Infinity)).toBe(0);
  expect(owner.actOn(2, solution, 1, Infinity)).toBe(0);
  const depths = owner.surfaceAction(1, solution, 1, Infinity),
    before = readLayer(map, 1, 0).depth;
  expect(depths[0]).toBeGreaterThan(0);
  expect(depths[0]).toBeLessThan(before);
  const removed: MaterialLayer[] = [];
  erodeFacets(map, 1, depths, "solution after transport", "load", (parcel) => removed.push(parcel));
  expect(readLayer(map, 1, 0).depth).toBeLessThan(before);
  expect(removed[0]).toMatchObject({
    kind: rocks.limestone.code,
    secondaryKind: rocks.shale.code,
    secondaryShare: 0.25,
    formedMin: 2,
    formedMax: 5,
    altered: 7,
    damage: 0.6,
    grainX: 600,
    grainY: 800,
  });
});
