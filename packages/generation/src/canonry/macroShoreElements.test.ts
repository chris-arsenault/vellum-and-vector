import { expect, it } from "vitest";
import { sampledDetailReader } from "@atlas/domain";
import { shoreElementWriter } from "./macroShoreElements";

it("fits a coastal element to water level instead of interpolating dry land into the ocean", () => {
  const positions = [-100, -10, 100, -10, 100, 10, -100, 10],
    channels = {elevation: [300, -100, -100, 300], bedrock: [290, -110, -110, 290]},
    elements: number[] = [],
    append = shoreElementWriter(positions, channels, elements, (p) => ({kind: p.x > 0 ? 1 : 0, level: 0}));
  append([0, 1, 2, 3]);
  const at = sampledDetailReader({positions: Float64Array.from(positions), elements: Uint32Array.from(elements),
    channels: {elevation: Float64Array.from(channels.elevation)}}, "elevation");
  for (const x of [-80, -20, 20, 80]) expect(at({x, y: 0, z: 0})! > 0).toBe(x < 0);
  expect(at({x: -0.1, y: 0, z: 0})!).toBeGreaterThan(0);
  expect(at({x: 0.1, y: 0, z: 0})!).toBeLessThan(0);
});
