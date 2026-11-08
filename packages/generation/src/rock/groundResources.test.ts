import { expect, it } from "vitest";
import { residentBand } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { atlasPhysicalProfile } from "../world/atlasProfile";
import { projectNative } from "../world/atlasProjection";
import type { PhysicalBufferName } from "../world/field";
import { createTestField as createField } from "./groundTestFixture";
import { createMesh } from "../world/mesh";
import { finishGroundImport, groundResourceBindings } from "./groundResources";
import { allColumnFields, allColumnIntegerFields, columnFields } from "./rockLayerFields";
import { layDownRock, readLayer, setLayer, stripRock } from "./rockColumn";
import { rockCatalogue } from "./rockCatalogue";

it("publishes every material field once with its own units and legacy land aliases", () => {
  const byNative = new Map(groundResourceBindings.map((binding) => [binding.native, binding]));
  expect(byNative.size).toBe(groundResourceBindings.length);
  expect(new Set(groundResourceBindings.map(({ name }) => name)).size).toBe(byNative.size);
  for (const name of allColumnFields) expect(byNative.has(name)).toBe(true);
  for (const name of allColumnIntegerFields) expect(byNative.get(name)?.unit).toBe("category");
  expect(byNative.get(columnFields.land.kind[0])?.name).toBe("rockLayer0");
  expect(byNative.get(columnFields.land.depth[0])).toMatchObject({
    name: "rockDepth0",
    scale: 1 / 1024,
  });
  expect(byNative.get(columnFields.cut.formedMin[0])).toMatchObject({ unit: "epoch", scale: 1 });
  expect(byNative.get("SeaLoadVolume")).toMatchObject({
    global: false,
    areaDensity: true,
    scale: 1,
  });
});

it("reconstructs projections from supplied facet material without overwriting its history", () => {
  const map = createField(createMesh(4, 0));
  map.BedrockElevation.set(0, 10_000);
  map.GroundCutShare.set(0, 0.25);
  map.GroundCutDepth.set(0, 400);
  setLayer(map, 0, 0, rockCatalogue.sandstone.code, 700, {
    strength: 1800,
    formedMin: 2,
    altered: 5,
    deposited: 3,
    consolidation: 0.7,
    bedSlopeX: -0.2,
  });
  setLayer(map, 0, 0, rockCatalogue.shale.code, 900, { strength: 600, formedMin: 1 }, "cut");
  setLayer(map, 0, 0, rockCatalogue.alluvium.code, 80, {}, "loose");
  setLayer(map, 0, 0, rockCatalogue.alluvium.code, 20, {}, "cutLoose");
  map.Elevation.set(0, 99_000);
  map.SedimentThickness.set(0, 7000);
  map.RockResistance.set(0, 999);
  finishGroundImport(map, new Set<PhysicalBufferName>([...allColumnFields, "BedrockElevation"]));
  expect(map.SedimentThickness.get(0)).toBe(65);
  expect(map.Elevation.get(0)).toBe(10_065);
  expect(map.RockResistance.get(0)).toBeLessThan(1500);
  expect(readLayer(map, 0, 0)).toMatchObject({
    strength: 1800,
    formedMin: 2,
    altered: 5,
    deposited: 3,
    consolidation: 0.7,
    bedSlopeX: -0.2,
  });
  expect(readLayer(map, 0, 0, "cut")).toMatchObject({
    kind: rockCatalogue.shale.code,
    formedMin: 1,
  });
});

it("imports known legacy surface facts without inventing buried history", () => {
  const map = createField(createMesh(4, 0));
  map.RockKindCodes.set(0, rockCatalogue.basalt.code);
  map.RockResistance.set(0, 1750);
  map.SedimentThickness.set(0, 55);
  map.BedrockElevation.set(0, 1000);
  const imported = new Set<PhysicalBufferName>([
    "RockKindCodes",
    "RockResistance",
    "SedimentThickness",
    "BedrockElevation",
  ]);
  finishGroundImport(map, imported);
  expect(readLayer(map, 0, 0)).toMatchObject({
    kind: rockCatalogue.basalt.code,
    strength: 1750,
    formedMin: -1,
    formedMax: -1,
    altered: -1,
  });
  expect(readLayer(map, 0, 0, "loose")).toMatchObject({ depth: 55, formedMin: -1 });
  expect(map.Elevation.get(0)).toBe(1055);
  expect(map.GroundCutShare.get(0)).toBe(0);
  layDownRock(map, 0, rockCatalogue.tufa, 20);
  stripRock(map, 0, 30);
  expect(readLayer(map, 0, 0)).toMatchObject({
    kind: rockCatalogue.basalt.code,
    formedMin: -1,
    formedMax: -1,
    altered: -1,
  });
});

it("publishes local sea cargo and carrier volumes as area densities", () => {
  const state = landscape(),
    map = createField(createMesh(4, 0)),
    active = Array.from({ length: map.mesh.count }, (_, cell) => cell).filter(
      (cell) => map.mesh.membership(cell) === 1 && map.mesh.area(cell) > 0
    );
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    grid: state.surface.coverage,
    samples: residentBand(
      "int32",
      Int32Array.from(state.surface.active, (_, cell) => active[cell % active.length])
    ),
    fixed: [],
    inherited: false,
  };
  for (let cell = 0; cell < map.mesh.count; cell++) {
    map.SeaLoadVolume.set(cell, map.mesh.area(cell) * (cell + 1));
    map.SeaLoadKind.set(cell, cell % 2 ? rockCatalogue.granite.code : rockCatalogue.shale.code);
    map.GroundLoadVolume.set(cell, map.mesh.area(cell) * 1.5);
    map.RockLayerFormedMin0.set(cell, 7);
  }
  projectNative(state, false, false, groundResourceBindings, new Set());
  expect(Array.from(state.surface.channels.SeaLoadVolume)).toEqual(
    Array.from(state.surface.active, (_, cell) => active[cell % active.length] + 1)
  );
  expect(Array.from(state.surface.channels.SeaLoadKind)).toEqual(
    Array.from(state.surface.active, (_, cell) =>
      active[cell % active.length] % 2 ? rockCatalogue.granite.code : rockCatalogue.shale.code
    )
  );
  expect(Array.from(state.surface.channels.GroundLoadVolume)).toEqual(
    Array(state.surface.active.length).fill(1.5)
  );
  expect(state.surface.channels.RockLayerFormedMin0.get(0)).toBe(7);
});
