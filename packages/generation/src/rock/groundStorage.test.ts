import { expect, it } from "vitest";
import { createField, physicalBands } from "../world/field";
import { createMesh } from "../world/mesh";
import { layDownRock, setLayer } from "./rockColumn";
import { rockCatalogue } from "./rockCatalogue";
import { shiftRock } from "./groundLedger";

it("publishes live ground readers without setters, replacement or mutable bulk aliases", () => {
  const map = createField(createMesh(4, 0)),
    depth = map.RockLayerDepth0,
    height = map.Elevation;
  setLayer(map, 0, 0, rockCatalogue.shale.code, 100);
  const copiedBlock = depth.block(0),
    copiedArray = depth.toArray(),
    snapshot = depth.snapshot(),
    named = map.coverage.band("RockLayerDepth0");
  copiedBlock[0] = 900;
  copiedArray[0] = 901;
  snapshot.set(0, 902);
  named.block(0)[0] = 903;
  map.coverage.forEachBlock([depth], ([block]) => block.fill(904));
  expect(depth.get(0)).toBe(100);
  expect("set" in depth).toBe(false);
  expect("copyFrom" in named).toBe(false);
  expect("fill" in height).toBe(false);
  expect(Reflect.set(map, "Elevation", snapshot)).toBe(false);
  expect(() => Object.defineProperty(map, "Elevation", { value: snapshot })).toThrow();
  layDownRock(map, 0, rockCatalogue.basalt, 30);
  shiftRock(map, 0, 50, "test");
  expect(depth.get(0)).toBe(30);
  expect(named.get(0)).toBe(30);
  expect(map.RockKindCodes.get(0)).toBe(rockCatalogue.basalt.code);
  expect(height.get(0)).toBe(50);
  expect(snapshot.get(0)).toBe(902);
});

it("bulk publication and coverage copies include protected ground without owning its originals", () => {
  const map = createField(createMesh(4, 0));
  setLayer(map, 0, 0, rockCatalogue.basalt.code, 60, { formedMin: 2, altered: 4 });
  const published = physicalBands(map),
    depth = published.find(([name]) => name === "RockLayerDepth0")![1],
    copy = map.coverage.copyBand(depth),
    copiedCoverage = map.coverage.snapshot(),
    copiedNamed = copiedCoverage.band("RockLayerDepth0");
  expect(depth.toArray()[0]).toBe(60);
  expect(published.find(([name]) => name === "RockLayerAltered0")![1].get(0)).toBe(4);
  copy.fill(10);
  copiedNamed.block(0)[0] = 20;
  copiedNamed.unpin(0);
  expect(depth.get(0)).toBe(60);
  expect(() =>
    map.coverage.allocate({ name: "Elevation", type: "float64", lifetime: "run" })
  ).toThrow();
});
