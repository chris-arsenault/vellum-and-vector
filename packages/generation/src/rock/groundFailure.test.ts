import { expect, it } from "vitest";
import { Stage } from "../coupling/stage";
import { createField } from "../world/field";
import { createWorldMesh } from "../world/worldMesh";
import { units } from "../world/math";
import { groundOf } from "./ground";
import { supportFailureDepth } from "./groundFailure";
import { cutGround, standGround } from "./groundLedger";
import { materialLayer, readLayer, setLayer } from "./rockColumn";
import { projectGround, type GroundSectionLayer } from "./groundShares";
import { compileMix, materialGives } from "./modes";
import { rockCatalogue as rocks } from "./rockCatalogue";

const shear = compileMix({ shear: 1 });
function section(support = rocks.shale.code, bedSlopeX = 0): GroundSectionLayer[] {
  return [
    {
      ...materialLayer(rocks.quartzite.code, units(10)),
      top: units(100),
      bottom: units(90),
      share: 1,
      medium: "rock",
      basement: false,
    },
    {
      ...materialLayer(support, units(20), { bedSlopeX }),
      top: units(90),
      bottom: units(70),
      share: 1,
      medium: "rock",
      basement: false,
    },
  ];
}

it("releases a finite cap and exposed weak support, but cannot attack a buried or strong foundation", () => {
  expect(supportFailureDepth(section(), units(70), [1, 0], 50, 1, shear)).toBe(units(30));
  expect(supportFailureDepth(section(), units(95), [1, 0], 5, 1, shear)).toBe(0);
  expect(supportFailureDepth(section(rocks.quartzite.code), units(70), [1, 0], 5, 1, shear)).toBe(
    0
  );
});

it("distinguishes a bed dipping toward a free face from the same bed dipping away", () => {
  expect(supportFailureDepth(section(rocks.shale.code, -1), units(70), [1, 0], 75, 1, shear)).toBe(
    units(30)
  );
  expect(supportFailureDepth(section(rocks.shale.code, 1), units(70), [1, 0], 75, 1, shear)).toBe(
    0
  );
  const bed = materialLayer(rocks.shale.code, units(20), { bedSlopeX: -1, grainX: 500 });
  expect(materialGives(shear, bed, false, 1, 0)).toBeGreaterThan(
    materialGives(shear, bed, false, -1, 0)
  );
  const abrasion = compileMix({ abrasion: 1 });
  expect(materialGives(abrasion, bed, false, 1, 0)).toBe(
    materialGives(abrasion, bed, false, -1, 0)
  );
});

function supplied() {
  const map = createField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  setLayer(map, 0, 0, rocks.quartzite.code, units(10), { formedMin: 2, formedMax: 2 });
  setLayer(map, 0, 1, rocks.shale.code, units(20), { formedMin: 1, formedMax: 1 });
  setLayer(map, 0, 2, rocks.granite.code, units(1000));
  standGround(map, 0, units(100), "supplied placement");
  setLayer(map, 1, 0, rocks.granite.code, units(1000));
  standGround(map, 1, units(60), "supplied placement");
  return map;
}

it("routes the failed facet's actual cap and foundation while the neighboring cut survives", () => {
  const map = supplied(),
    owner = groundOf(map);
  cutGround(map, 0, units(20), 0.25, "supplied incision");
  standGround(map, 2, units(95), "supplied buttress");
  const cutBefore = owner.section(0, "cut"),
    failure = owner.failureFrom(0, "land", shear),
    failed = failure(1, 50, 1),
    stage = new Stage(map, { simultaneous: true });
  expect(failed).toBe(units(30));
  expect(failure(2, 50, 1)).toBe(0);
  stage.moveSurface(
    0,
    1,
    (failed / 1024) * owner.share(0, "land") * map.mesh.area(0),
    "collapse",
    "land"
  );
  stage.settle();
  expect(readLayer(map, 0, 0).kind).toBe(rocks.granite.code);
  expect(owner.section(0, "cut")).toEqual(cutBefore);
  expect(readLayer(map, 1, 0, "loose")).toMatchObject({
    kind: rocks.shale.code,
    secondaryKind: rocks.quartzite.code,
    formedMin: 1,
    formedMax: 2,
  });
  expect(owner.failureDepth(0, 1, "land", shear, 50, 1)).toBe(0);
  expect(owner.failureFrom(0, "land", shear)(1, 50, 1)).toBe(0);
});

it("passes carrier direction through deferred surface wear into the actual removal", () => {
  const map = supplied(),
    plucking = compileMix({ plucking: 1 });
  for (const cell of [0, 1]) {
    setLayer(map, cell, 0, rocks.shale.code, units(100), { bedSlopeX: -1 });
    projectGround(map, cell);
  }
  const stage = new Stage(map, { simultaneous: true }),
    cause = { id: "directed wear", remembers: "CumulativeGlacialErosion" } as const;
  stage.attack(cause, 0, plucking, 1, units(100), [1, 0]);
  stage.attack(cause, 1, plucking, 1, units(100), [-1, 0]);
  stage.settle();
  expect(readLayer(map, 0, 0).depth).toBeLessThan(readLayer(map, 1, 0).depth);
});
