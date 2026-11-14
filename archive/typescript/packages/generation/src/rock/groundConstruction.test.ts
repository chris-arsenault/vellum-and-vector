import { expect, it } from "vitest";
import { createTestField } from "./groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { units } from "../world/math";
import { constructMaterial, depositedMaterial } from "./groundConstruction";
import { materialLayer, materialStrength, readLayer, setLayer, watchColumn } from "./rockColumn";
import { burialResponse } from "./modes";
import { rockCatalogue as rocks } from "./rockCatalogue";
import { openCut, projectGround, facetSurface } from "./groundShares";

it("reworking establishes a new loose bed without recreating its clasts or fabric", () => {
  const source = materialLayer(
      rocks.granite.code,
      units(3),
      {
        strength: 1700,
        grainX: 0.7,
        bedSlopeX: 0.3,
        bedSlopeY: -0.2,
        altered: 6,
      },
      2
    ),
    bed = depositedMaterial(source, 8),
    cemented = burialResponse(bed, 9);
  expect(bed).toMatchObject({
    formedMin: 2,
    formedMax: 2,
    altered: 6,
    deposited: 8,
    grainX: 0.7,
    strength: 1700,
    bedSlopeX: 0,
    bedSlopeY: 0,
    consolidation: 0,
  });
  expect(cemented).toMatchObject({ strength: 1700, deposited: 8, formedMin: 2 });
  expect(materialStrength(bed)).toBeLessThan(materialStrength(cemented));
  expect(materialStrength(cemented)).toBeLessThan(materialStrength(source));
});

it("solid emplacement buries only the covered facet and commits its placement and history", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  map.BedrockElevation.set(0, units(100));
  setLayer(map, 0, 0, rocks.gneiss.code, units(10_000));
  openCut(map, 0, 0.25);
  map.GroundCutDepth.set(0, units(20));
  setLayer(map, 0, 0, rocks.limestone.code, units(3), { formedMin: 2 }, "cutLoose");
  setLayer(map, 0, 0, rocks.shale.code, units(2), { formedMin: 1 }, "loose");
  projectGround(map, 0);
  const intact = facetSurface(map, 0, "land"),
    cut = facetSurface(map, 0, "cut");
  expect(
    constructMaterial(
      map,
      0,
      materialLayer(rocks.basalt.code, units(4), {}, 7),
      "test",
      "melt",
      "cut"
    )
  ).toBe(units(1));
  expect(facetSurface(map, 0, "land")).toBe(intact);
  expect(facetSurface(map, 0, "cut")).toBe(cut + units(4));
  expect(readLayer(map, 0, 0, "cut")).toMatchObject({ kind: rocks.basalt.code, deposited: 7 });
  expect(readLayer(map, 0, 1, "cut")).toMatchObject({
    kind: rocks.limestone.code,
    formedMin: 2,
    consolidation: 0,
  });
  expect(readLayer(map, 0, 0, "loose")).toMatchObject({ kind: rocks.shale.code, depth: units(2) });
});

it("observes accepted construction with its actual cause and detaches without affecting emplacement", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    material = materialLayer(rocks.saltbed.code, units(2), {}, 3),
    seen: object[] = [],
    stop = watchColumn({
      fold() {},
      strip() {},
      construct(field, cell, bed, cause, depth) {
        expect(field).toBe(map);
        seen.push({ cell, kind: bed.kind, cause, depth, surface: readLayer(field, cell, 0).kind });
      },
    });
  try {
    constructMaterial(map, 0, material, "salt", "space");
    expect(seen).toEqual([
      {
        cell: 0,
        kind: rocks.saltbed.code,
        cause: "salt",
        depth: units(2),
        surface: rocks.saltbed.code,
      },
    ]);
    stop();
    constructMaterial(map, 0, material, "salt", "space");
    expect(seen).toHaveLength(1);
    expect(readLayer(map, 0, 0).depth).toBe(units(4));
  } finally {
    stop();
  }
});
