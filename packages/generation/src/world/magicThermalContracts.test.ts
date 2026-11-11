import { expect, it, vi } from "vitest";
import { localSeaIce, retainedSeaIce, seaIceWork } from "./seaIce";
import { pressureAtDepth } from "./magicSources";
import { createTestField } from "../rock/groundTestFixture";
import { createWorldMesh } from "./worldMesh";
import {
  meltIce,
  receiveIceMelt,
  meltedInventory,
  setIceResponse,
} from "../rock/groundSurfaceMedia";

it("preservation retains existing sea ice without creating ice or preventing all warm-water loss", () => {
  expect(retainedSeaIce(0, 1, 0, 2)).toBe(0);
  expect(retainedSeaIce(10, 0, 0, 2)).toBe(0);
  expect(retainedSeaIce(10, 0.8, 0, 2)).toBe(8);
  expect(retainedSeaIce(10, 0.8, 10, 2)).toBe(0);
  expect(retainedSeaIce(0.01, 1, 1, 2)).toBe(0);
});
it("water load increases Pressure source response smoothly from zero", () => {
  expect(pressureAtDepth(0, 100)).toBe(0);
  expect(pressureAtDepth(300, 100)).toBeGreaterThan(pressureAtDepth(30, 100));
});
it("local sea-ice work permits freezing and thaw while zero-work refresh preserves thickness", () => {
  expect(localSeaIce(10, 0, 0)).toBe(10);
  expect(localSeaIce(0, 10, 0)).toBe(0);
  expect(localSeaIce(10, 0, 1 / 3)).toBeLessThan(10);
  expect(localSeaIce(10, 0, 1 / 3)).toBeGreaterThan(0);
  expect(localSeaIce(0, 10, 1 / 3)).toBeGreaterThan(0);
  expect(localSeaIce(10, 10, 1 / 3)).toBe(10);
});
it("distinguishes explicit local work from a refresh or a repeated historical epoch", () => {
  expect(seaIceWork(-1, -1, undefined, 1)).toBe(0);
  expect(seaIceWork(2, 2, undefined, 1)).toBe(0);
  expect(seaIceWork(3, 2, undefined, 1)).toBe(1);
  expect(seaIceWork(-1, -1, true, 1 / 3)).toBe(1 / 3);
  expect(seaIceWork(0, -1, false, 1)).toBe(0);
});
it("actual basal melting retains water separately from recomputed runoff", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  map.IceThickness.set(0, 3);
  expect(meltIce(map, 0, 8, "test", true)).toBe(3);
  expect(map.ExternalMeltwater.get(0)).toBe(3000);
  map.GlacialMeltwater.set(0, 0);
  expect(map.ExternalMeltwater.get(0)).toBe(3000);
  expect(meltIce(map, 0, 8, "test", true)).toBe(0);
});

it("basal melt retains the command's rate while carriers receive only the actual removed depth", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    receive = vi.fn();
  receiveIceMelt(map, receive);
  map.IceThickness.set(0, 3);
  expect(meltIce(map, 0, 2, "test", true, 0)).toBe(0);
  expect(map.IceThickness.get(0)).toBe(3);
  expect(meltIce(map, 0, 2, "test", true, 0.5)).toBe(2);
  expect(map.ExternalMeltwater.get(0)).toBe(4000);
  expect(map.GlacialMeltwater.get(0)).toBe(4000);
  expect(receive).toHaveBeenCalledExactlyOnceWith(0, 2, 3);
});

it("ice ablation notifies inventory owners of the actual carrier fraction, while formation does not", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    receive = vi.fn();
  receiveIceMelt(map, receive);
  setIceResponse(map, 0, 4, "test");
  expect(receive).not.toHaveBeenCalled();
  setIceResponse(map, 0, 3, "test");
  expect(receive).toHaveBeenLastCalledWith(0, 1, 4);
  expect(meltedInventory(80, 1, 4)).toBe(20);
  meltIce(map, 0, 30, "test");
  expect(receive).toHaveBeenLastCalledWith(0, 3, 3);
  expect(meltedInventory(60, 3, 3)).toBe(60);
  meltIce(map, 0, 1, "test");
  expect(receive).toHaveBeenCalledTimes(2);
});
