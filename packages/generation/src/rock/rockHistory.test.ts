import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "../canonry/atlasProfile";
import { physicalContext } from "../canonry/context";
import { createField, type PhysicalField } from "../canonry/field";
import { units } from "../canonry/math";
import { createMesh } from "../canonry/mesh";
import { layerDepth, layerKind, setLayer } from "./rockColumn";
import { rockCatalogue } from "./rockCatalogue";
import { initializeRock, metamorphism } from "./rockHistory";

const { shale, slate, limestone, marble, sandstone, quartzite, gneiss } = rockCatalogue,
  context = () => physicalContext(7, 0, atlasPhysicalProfile(), null, 0, 1);
/** Thin shale, then limestone at 1 km, then sandstone at 4 km, over gneiss. */
function buried(built: (i: number) => number): PhysicalField {
  const map = createField(createMesh(40, 1));
  for (let i = 0; i < map.mesh.count; i++) {
    setLayer(map, i, 0, shale.code, units(1000));
    setLayer(map, i, 1, limestone.code, units(3000));
    setLayer(map, i, 2, sandstone.code, units(2000));
    setLayer(map, i, 3, gneiss.code, units(30_000));
    map.OrogenicConstruction.set(i, units(built(i)));
  }
  return map;
}
const kinds = (map: PhysicalField, i: number) => [0, 1, 2].map((layer) => layerKind(map, i, layer));

it("bakes what lies deep under full heat and leaves the surface", () => {
  const map = buried(() => 500);
  metamorphism(map);
  expect(kinds(map, 0)).toEqual([shale.code, limestone.code, quartzite.code]);
});
it("gives neighbours with one history one result, without a roll", () => {
  const map = buried(() => 500);
  metamorphism(map);
  const columns = new Set(Array.from({ length: map.mesh.count }, (_, i) => kinds(map, i).join()));
  expect(columns.size).toBe(1);
});
it("reaches less deep under less heat, so grade falls away from a belt's core", () => {
  const map = buried(() => 12);
  metamorphism(map);
  // A tenth of the heat needs ten times the depth, past the sandstone's top at 4 km.
  expect(kinds(map, 0)).toEqual([shale.code, limestone.code, sandstone.code]);
});
it("carries on to a layer's next form with another pass", () => {
  const map = buried(() => 500);
  setLayer(map, 0, 2, limestone.code, units(2000));
  metamorphism(map);
  expect(layerKind(map, 0, 2)).toBe(marble.code);
  setLayer(map, 0, 2, shale.code, units(2000));
  metamorphism(map);
  expect(layerKind(map, 0, 2)).toBe(slate.code);
});
it("starts a continental platform with kilometres of alternating beds", () => {
  let platforms = 0;
  for (let province = 0; province < 20; province++) {
    const map = createField(createMesh(4, 1));
    map.CrustContinentalFraction.fill(1000);
    map.CrustProvinceIds.fill(province);
    initializeRock(map, context());
    if (layerDepth(map, 0, 1) <= 0) continue; // A shield, planed to its basement.
    platforms++;
    let beds = 0,
      thick = 0;
    while (layerDepth(map, 0, beds + 1) > 0) thick += layerDepth(map, 0, beds++);
    expect(beds).toBeGreaterThanOrEqual(4);
    expect(thick / 1024).toBeGreaterThan(3000);
    for (let bed = 1; bed < beds; bed++)
      expect(layerKind(map, 0, bed)).not.toBe(layerKind(map, 0, bed - 1));
  }
  expect(platforms).toBeGreaterThan(0);
});
