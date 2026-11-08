import { expect, it } from "vitest";
import { residentBand } from "@atlas/domain";
import { createTestField } from "./groundTestFixture";
import { createMesh } from "../world/mesh";
import { units } from "../world/math";
import { buildTransportPlan, releaseTransportPlan } from "../world/transportPlan";
import { rockCatalogue } from "./rockCatalogue";
import { readLayer, setLayer, type MaterialLayer } from "./rockColumn";
import { projectGround, rockSurface, columnThickness } from "./groundShares";
import { holdRock, releaseHeldRock } from "./groundTransport";
import { remapHeldGround } from "./groundRemap";
import { withdrawColumn } from "./groundMaterial";
import { cutGround } from "./groundLedger";

const { basalt, granite, limestone, shale } = rockCatalogue;
function ground() {
  const map = createTestField(createMesh(4, 0));
  for (const cell of [0, 1, 2]) setLayer(map, cell, 0, granite.code, units(30_000));
  map.CrustSuturePairIds.set(0, 7);
  map.CrustSutureStrength.set(0, 200);
  map.CrustSuturePairIds.set(1, 9);
  map.CrustSutureStrength.set(1, 900);
  return map;
}
function arrival(map: ReturnType<typeof ground>, weights = [0.5, 0.5]) {
  for (const cell of [0, 1]) projectGround(map, cell);
  const held = holdRock(map),
    plan = buildTransportPlan(map, 0),
    arrivals = {
      offsets: residentBand("int32", [0, 0, 0, 2]),
      sources: residentBand("int32", [0, 1]),
      weights: residentBand("float64", weights),
    };
  return {
    plan,
    commit: () => remapHeldGround(map, held, 2, arrivals, plan),
    release: () => {
      releaseHeldRock(map, held);
      releaseTransportPlan(map, plan);
    },
  };
}
it("remaps a contrasting elevated cap and its inherited beds with placement, without lateral stacking", () => {
  const map = ground();
  setLayer(map, 0, 0, basalt.code, units(10), { formedMin: 2, formedMax: 2, altered: 3 });
  setLayer(map, 0, 1, limestone.code, units(30), { formedMin: 0, formedMax: 0 });
  setLayer(map, 0, 2, granite.code, units(30_000));
  map.BedrockElevation.set(0, units(1000));
  map.SurfaceRockLoad.set(0, units(100));
  map.CrustThickness.set(2, units(7000));
  map.CrustRootReserve.set(2, units(400));
  const remap = arrival(map);
  remap.commit();
  remap.release();
  expect(map.Elevation.get(2)).toBe(units(500));
  expect(readLayer(map, 2, 0)).toMatchObject({
    kind: basalt.code,
    depth: units(5),
    secondaryShare: 0,
    formedMin: 2,
    formedMax: 2,
    altered: 3,
  });
  withdrawColumn(map, 2, "land", units(5));
  const exposed = readLayer(map, 2, 0);
  expect([exposed.kind, exposed.secondaryKind]).toContain(limestone.code);
  expect(exposed.depth).toBe(units(15));
  expect(map.CrustThickness.get(2)).toBe(units(7000));
  expect(map.CrustRootReserve.get(2)).toBe(units(400));
});
it("keeps the common basal contact when a tall cap overlaps a shorter exposed basement", () => {
  const map = ground();
  setLayer(map, 0, 0, basalt.code, units(1000), { formedMin: 1, formedMax: 1 });
  setLayer(map, 0, 1, granite.code, units(30_000));
  map.BedrockElevation.set(0, units(1000));
  const remap = arrival(map);
  remap.commit();
  remap.release();
  expect(map.BedrockElevation.get(2)).toBe(units(500));
  expect(readLayer(map, 2, 0)).toMatchObject({
    kind: basalt.code,
    depth: units(500),
    formedMin: 1,
  });
  expect(readLayer(map, 2, 1)).toMatchObject({ kind: granite.code, secondaryShare: 0 });
});
it("retains conditional cut geometry and finite cover when the other donor has neither", () => {
  const map = ground();
  map.BedrockElevation.set(0, units(100));
  map.GroundCutShare.set(0, 0.5);
  map.GroundCutDepth.set(0, units(40));
  setLayer(map, 0, 0, limestone.code, units(30_000), { altered: 2 }, "cut");
  setLayer(map, 0, 0, shale.code, units(20), { deposited: 1, consolidation: 0 }, "loose");
  setLayer(map, 0, 0, basalt.code, units(8), { deposited: 2, consolidation: 0 }, "cutLoose");
  const remap = arrival(map);
  remap.commit();
  remap.release();
  expect(map.GroundCutShare.get(2)).toBe(0.75);
  expect(rockSurface(map, 2, "land")).toBeCloseTo(units(80));
  expect(rockSurface(map, 2, "cut")).toBeCloseTo(units(40));
  expect(map.GroundCutDepth.get(2)).toBeCloseTo(units(40));
  expect(columnThickness(map, 2, "cutLoose")).toBeCloseTo(units(20) / 3);
  expect(readLayer(map, 2, 0, "cutLoose")).toMatchObject({ kind: shale.code, deposited: 1 });
  expect(readLayer(map, 2, 0, "loose")).toMatchObject({
    kind: basalt.code,
    depth: units(8),
    deposited: 2,
  });
  expect(readLayer(map, 2, 0, "land").kind).toBe(limestone.code);
  expect(map.Elevation.get(2)).toBeCloseTo(units(57));
  const removed: MaterialLayer[] = [];
  cutGround(map, 2, units(1), 0.75, "test", (material) => removed.push(material));
  expect(removed[0]).toMatchObject({ kind: shale.code, deposited: 1 });
  expect(readLayer(map, 2, 0, "loose").depth).toBe(units(8));
});
it("rotates each source before mixing and keeps a seam identity with its own strength", () => {
  const map = ground();
  setLayer(map, 0, 0, basalt.code, units(30_000), { bedSlopeX: 0.2, grainX: 1000 });
  setLayer(map, 1, 0, basalt.code, units(30_000), { bedSlopeX: 0.2, grainX: 1000 });
  const remap = arrival(map, [0.75, 0.25]);
  remap.plan.deformationXX.set(0, 0);
  remap.plan.deformationXY.set(0, -1);
  remap.plan.deformationYX.set(0, 1);
  remap.plan.deformationYY.set(0, 0);
  remap.commit();
  remap.release();
  expect(readLayer(map, 2, 0)).toMatchObject({ bedSlopeX: 0.05, grainX: -500 });
  expect(readLayer(map, 2, 0).bedSlopeY).toBeCloseTo(0.15);
  expect(map.CrustSuturePairIds.get(2)).toBe(7);
  expect(map.CrustSutureStrength.get(2)).toBe(200);
});
it("orders a single donor by its filled surfaces before the next cut selects material", () => {
  const map = ground();
  map.BedrockElevation.set(0, units(100));
  map.GroundCutShare.set(0, 0.25);
  map.GroundCutDepth.set(0, units(40));
  setLayer(map, 0, 0, limestone.code, units(30_000), {}, "cut");
  setLayer(map, 0, 0, basalt.code, units(60), { deposited: 2 }, "cutLoose");
  const remap = arrival(map, [1, 0]);
  remap.commit();
  remap.release();
  expect(map.GroundCutShare.get(2)).toBe(0.75);
  expect(map.GroundCutDepth.get(2)).toBe(units(-40));
  expect(readLayer(map, 2, 0, "cut").kind).toBe(granite.code);
  expect(readLayer(map, 2, 0, "loose")).toMatchObject({ kind: basalt.code, depth: units(60) });
  const removed: MaterialLayer[] = [];
  cutGround(map, 2, units(1), 0.75, "test", (material) => removed.push(material));
  expect(removed[0].kind).toBe(granite.code);
  expect(readLayer(map, 2, 0, "loose").depth).toBe(units(60));
});
it("keeps finite buried contacts when differently layered arrivals exhaust the bounded slots", () => {
  const map = ground();
  for (const cell of [0, 1]) {
    for (let slot = 0; slot < 7; slot++)
      setLayer(
        map,
        cell,
        slot,
        slot % 2 ? shale.code : basalt.code,
        units(100 + cell * 50 + slot * 100),
        { formedMin: cell, formedMax: cell }
      );
    setLayer(map, cell, 7, granite.code, units(30_000));
  }
  const remap = arrival(map);
  remap.commit();
  remap.release();
  expect(readLayer(map, 2, 0)).toMatchObject({
    kind: basalt.code,
    depth: units(100),
    formedMin: 0,
    formedMax: 1,
  });
  expect(readLayer(map, 2, 7).kind).toBe(granite.code);
  expect(
    Array.from({ length: 7 }, (_, slot) => readLayer(map, 2, slot)).some((layer) => layer.mixed > 0)
  ).toBe(true);
});
