import { expect, it } from "vitest";
import { rockCatalogue } from "./rockCatalogue";
import { bodyRank, heldLeakIn, stockLeakIn } from "./rockMagic";

const grid = (step: number, size: number) => {
  const points: [number, number][] = [];
  for (let x = 0; x < size; x += step) for (let y = 0; y < size; y += step) points.push([x, y]);
  return points;
};

it("gives a body about the share of the ground asked for", () => {
  const points = grid(25_000, 8_000_000);
  for (const share of [0.1, 0.3, 0.6]) {
    const inside = points.filter(([x, y]) => bodyRank(x, y, 77) < share).length / points.length;
    expect(Math.abs(inside - share)).toBeLessThan(0.08);
  }
});
it("forms bodies that hold together rather than static", () => {
  const step = 25_000,
    points = grid(step, 4_000_000),
    share = 0.3;
  let same = 0;
  for (const [x, y] of points)
    if (bodyRank(x, y, 77) < share === bodyRank(x + step, y, 77) < share) same++;
  // Independent rolls at this share would agree 58% of the time.
  expect(same / points.length).toBeGreaterThan(0.85);
});
it("keeps a system's stock according to how its rock is built", () => {
  const { veinrock, tornstone, sandstone, shale, quartzite, keptStone, crushstone } = rockCatalogue;
  // Fire leaks out of jointed rock and stays in tight rock.
  expect(heldLeakIn("fire", tornstone)).toBeGreaterThan(heldLeakIn("fire", veinrock));
  // Veil's tears stay open in broken rock.
  expect(heldLeakIn("veil", tornstone)).toBeLessThan(heldLeakIn("veil", veinrock));
  // Hallowed holds where the rock is hard.
  expect(heldLeakIn("hallowed", keptStone)).toBeLessThan(heldLeakIn("hallowed", crushstone));
  // An aquifer holds in porous rock.
  expect(stockLeakIn("aquifer", sandstone)).toBeLessThan(stockLeakIn("aquifer", shale));
  // Aurora's ground charge drains from porous rock.
  expect(stockLeakIn("ground", sandstone)).toBeGreaterThan(stockLeakIn("ground", quartzite));
});
