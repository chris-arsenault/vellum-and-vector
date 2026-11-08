import { expect, it } from "vitest";
import { createMesh } from "../world/mesh";
import { units } from "../world/math";
import { createTestField } from "./groundTestFixture";
import { rockCatalogue } from "./rockCatalogue";
import { widenIncision } from "./groundIncision";
import {
  layDownPackage,
  materialLayer,
  readLayer,
  setLayer,
  stripRock,
  type Column,
} from "./rockColumn";

const { basalt, shale, sandstone, limestone, gneiss, tufa, rimerot } = rockCatalogue;
function inherited(column: Column = "land") {
  const map = createTestField(createMesh(4, 0));
  for (const [slot, kind] of [shale, sandstone, limestone, gneiss].entries())
    setLayer(
      map,
      0,
      slot,
      kind.code,
      units(slot === 3 ? 30_000 : (slot + 1) * 1000),
      {
        formedMin: slot,
        formedMax: slot,
        altered: 4,
        grainX: 0.6,
      },
      column
    );
  return map;
}
it.each(["land", "cut"] as const)(
  "preserves inherited %s contacts under repeated small arrivals",
  (column) => {
    const map = inherited(column);
    map.GroundCutShare.set(0, 0.4);
    for (let at = 0; at < 40; at++)
      layDownPackage(map, 0, column, [
        materialLayer(basalt.code, units(at % 2 ? 0.5 : 1), {
          damage: at / 100,
          formedMin: 5,
          formedMax: 5,
          altered: 5,
        }),
      ]);
    const layers = Array.from({ length: 8 }, (_, slot) => readLayer(map, 0, slot, column));
    for (const kind of [shale, sandstone, limestone])
      expect(layers.find((layer) => layer.kind === kind.code)).toMatchObject({
        mixed: 0,
        altered: 4,
        grainX: 0.6,
      });
    expect(layers[0]).toMatchObject({ kind: basalt.code, depth: units(0.5), mixed: 0 });
    expect(layers[7]).toMatchObject({ kind: gneiss.code, depth: units(30_000), mixed: 0 });
    expect(map.GroundCutShare.get(0)).toBe(0.4);
    stripRock(map, 0, units(30), column);
    expect(readLayer(map, 0, 0, column)).toMatchObject({
      kind: shale.code,
      altered: 4,
      grainX: 0.6,
    });
  }
);
it("does not spend six slots on microscopic arrivals while destroying hundred-metre contacts", () => {
  const map = inherited();
  for (let slot = 0; slot < 3; slot++) {
    const layer = readLayer(map, 0, slot);
    setLayer(map, 0, slot, layer.kind, units(100), layer);
  }
  for (let at = 0; at < 40; at++)
    layDownPackage(map, 0, "land", [
      materialLayer(basalt.code, 1e-20 * 1024, { damage: at / 100, formedMin: 7, formedMax: 7 }),
    ]);
  const layers = Array.from({ length: 8 }, (_, slot) => readLayer(map, 0, slot));
  for (const kind of [shale, sandstone, limestone])
    expect(layers.find((layer) => layer.kind === kind.code)).toMatchObject({
      depth: units(100),
      mixed: 0,
    });
  expect(layers[0]).toMatchObject({ kind: basalt.code, depth: 1e-20 * 1024, mixed: 0 });
});
it("protects the new cap while allowing the previous thin cap to coarsen", () => {
  const map = inherited(),
    kinds = [tufa, rimerot, shale, sandstone, limestone, basalt, shale, gneiss];
  kinds.forEach((kind, slot) =>
    setLayer(map, 0, slot, kind.code, units(slot < 2 ? 0.5 : 1000), {
      formedMin: slot,
      formedMax: slot,
    })
  );
  layDownPackage(map, 0, "land", [
    materialLayer(basalt.code, units(0.25), { formedMin: 9, formedMax: 9 }),
  ]);
  expect(readLayer(map, 0, 0)).toMatchObject({ kind: basalt.code, depth: units(0.25), mixed: 0 });
  expect(readLayer(map, 0, 1)).toMatchObject({
    depth: units(1),
    mixed: 1,
    formedMin: 0,
    formedMax: 1,
  });
  expect(readLayer(map, 0, 7)).toMatchObject({ kind: gneiss.code, mixed: 0 });
});
it("prefers equivalent buried material before blending a thinner contrasting contact", () => {
  const map = inherited(),
    kinds = [tufa, rimerot, shale, sandstone, limestone, limestone, basalt, gneiss];
  kinds.forEach((kind, slot) =>
    setLayer(map, 0, slot, kind.code, units(slot < 2 ? 1 : 100), {
      formedMin: slot,
      formedMax: slot,
    })
  );
  layDownPackage(map, 0, "land", [materialLayer(basalt.code, units(1))]);
  expect(readLayer(map, 0, 1)).toMatchObject({ kind: tufa.code, depth: units(1), mixed: 0 });
  expect(readLayer(map, 0, 2)).toMatchObject({ kind: rimerot.code, depth: units(1), mixed: 0 });
  expect(readLayer(map, 0, 5)).toMatchObject({
    kind: limestone.code,
    depth: units(200),
    formedMin: 4,
    formedMax: 5,
  });
});
it("uses the deeper contact for equal-thickness alternatives", () => {
  const map = inherited(),
    kinds = [tufa, rimerot, shale, sandstone, limestone, basalt, shale, gneiss];
  kinds.forEach((kind, slot) => setLayer(map, 0, slot, kind.code, units(100)));
  layDownPackage(map, 0, "land", [materialLayer(basalt.code, units(1))]);
  expect(readLayer(map, 0, 1)).toMatchObject({ kind: tufa.code, mixed: 0 });
  expect(readLayer(map, 0, 6)).toMatchObject({ depth: units(200), mixed: 1 });
  expect(readLayer(map, 0, 7)).toMatchObject({ kind: gneiss.code, mixed: 0 });
});

it("uses the same capacity rule when widening combines cut and intact profiles", () => {
  const map = inherited("cut"),
    thin = [basalt, tufa, rimerot, rockCatalogue.quartzite, rockCatalogue.granite, basalt];
  thin.forEach((kind, slot) => setLayer(map, 0, slot, kind.code, units(0.5), { altered: 8 }));
  setLayer(map, 0, 6, shale.code, units(1000), { altered: 8 });
  setLayer(map, 0, 7, gneiss.code, units(30_000));
  map.GroundCutShare.set(0, 0.3);
  widenIncision(map, 0, 0.6, units(1), -Infinity, () => {});
  const cut = Array.from({ length: 8 }, (_, slot) => readLayer(map, 0, slot, "cut"));
  for (const kind of [shale, sandstone, limestone])
    expect(cut.find((layer) => layer.kind === kind.code && layer.altered === 4)).toMatchObject({
      mixed: 0,
      grainX: 0.6,
    });
  expect(cut[0]).toMatchObject({ kind: shale.code, altered: 4 });
  expect(cut[7]).toMatchObject({ kind: gneiss.code, depth: units(30_000) });
  expect(readLayer(map, 0, 0)).toMatchObject({ kind: basalt.code, depth: units(0.5), altered: 8 });
  expect(map.GroundCutShare.get(0)).toBe(0.6);
});
