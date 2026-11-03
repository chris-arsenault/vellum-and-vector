import { expect, it } from "vitest";
import { migrateMeanders, resample } from "./meanders";

type Point = [number, number];
const length = (line: Point[]) =>
  line.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0);
const sinuosity = (line: Point[]) =>
  length(line) / Math.hypot(line.at(-1)![0] - line[0][0], line.at(-1)![1] - line[0][1]);
const straight = (km: number): Point[] => [
  [0, 0],
  [km * 1000, 0],
];
const draw = (k: number) => (((Math.sin(k * 12.9898) * 43758.5453) % 1) + 1) % 1;

it("resamples a course at an even spacing and keeps both ends", () => {
  const line = resample(straight(1), 100);
  expect(line[0]).toEqual([0, 0]);
  expect(line.at(-1)).toEqual([1000, 0]);
  expect(line).toHaveLength(11);
});

it("grows bends on an open floor and keeps the reach's ends at its confluences", () => {
  const { line } = migrateMeanders({
    line: straight(20),
    width: 100,
    steps: 400,
    floor: () => true,
    draw,
  });
  expect(sinuosity(line)).toBeGreaterThan(1.3);
  expect(line[0]).toEqual([0, 0]);
  expect(line.at(-1)).toEqual([20_000, 0]);
});

it("keeps a confined channel inside its valley walls, winding less than a free one", () => {
  const halfFloor = 150,
    run = (floor: (p: Point) => boolean) =>
      migrateMeanders({ line: straight(20), width: 100, steps: 300, floor, draw }).line,
    confined = run(([, y]) => Math.abs(y) <= halfFloor),
    free = run(() => true);
  expect(Math.max(...confined.map(([, y]) => Math.abs(y)))).toBeLessThanOrEqual(halfFloor);
  expect(sinuosity(confined)).toBeLessThan(sinuosity(free));
});

it("cuts a tight loop off at its neck and leaves it as an oxbow", () => {
  const loop: Point[] = [
    [0, 0],
    [1000, 0],
  ];
  for (let a = 0; a <= 330; a += 15)
    loop.push([
      1000 + 300 * Math.sin((a * Math.PI) / 180),
      300 - 300 * Math.cos((a * Math.PI) / 180),
    ]);
  loop.push([1050, 0], [3000, 0]);
  const { oxbows, line } = migrateMeanders({
    line: loop,
    width: 100,
    steps: 1,
    floor: () => true,
    draw: () => 0.5,
  });
  expect(oxbows.length).toBeGreaterThan(0);
  expect(length(line)).toBeLessThan(length(loop));
});

it("makes larger bends for a wider river", () => {
  const bendLength = (width: number) => {
    const { line } = migrateMeanders({
      line: straight(40),
      width,
      steps: 400,
      floor: () => true,
      draw,
    });
    // Mean distance between sign changes of the course's offset from its axis.
    let crossings = 0;
    for (let k = 1; k < line.length; k++)
      if (Math.sign(line[k][1]) !== Math.sign(line[k - 1][1])) crossings++;
    return 40_000 / Math.max(1, crossings);
  };
  expect(bendLength(200)).toBeGreaterThan(bendLength(50));
});
