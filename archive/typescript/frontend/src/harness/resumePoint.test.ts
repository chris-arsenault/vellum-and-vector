import { deserialize, serialize } from "node:v8";
import { expect, it } from "vitest";
import { Band, generateBand, sampleCoverage } from "@atlas/domain";
import { detach, revive } from "./resumePoint";

class Rebuilt {
  value = 1;
}
const saved = (value: unknown) => deserialize(serialize(detach(value)));

it("puts saved values back into the bands and containers a fresh run already built", () => {
  const coverage = sampleCoverage(4),
    heat = generateBand(coverage, "float64", "heat", (i) => i + 0.5),
    source = {
      heat,
      fields: [{ stock: generateBand(coverage, "float64", "stock", (i) => i * 2) }],
      seeded: new Set(["impact"]),
      outlines: new Map([[3, { type: "Point" }]]),
      epoch: 2,
      rebuilt: new Rebuilt(),
      read: () => 0,
    };
  const copy = saved(source);
  const fresh = sampleCoverage(4),
    existing = generateBand(fresh, "float64", "heat", () => 0),
    kept = new Rebuilt(),
    target = { heat: existing, fields: [] as { stock?: Band }[], epoch: 0, rebuilt: kept };
  revive(target, copy, fresh);
  // The band the initializers made is reused; a band they had not made yet is created.
  expect(target.heat).toBe(existing);
  expect(Array.from(target.heat.toArray())).toEqual([0.5, 1.5, 2.5, 3.5]);
  expect(Array.from(target.fields[0].stock!.toArray())).toEqual([0, 2, 4, 6]);
  expect(target.epoch).toBe(2);
  expect((target as unknown as typeof source).seeded).toEqual(new Set(["impact"]));
  expect((target as unknown as typeof source).outlines.get(3)).toEqual({ type: "Point" });
  // Objects the run rebuilds are left as the run built them, and functions are not saved.
  expect(target.rebuilt).toBe(kept);
  expect("read" in target).toBe(false);
});
it("refuses state that refers back to itself", () => {
  const loop: Record<string, unknown> = {};
  loop.self = loop;
  expect(() => detach(loop)).toThrow("cycle");
});
