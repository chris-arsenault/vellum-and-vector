import { expect, it } from "vitest";
import {
  areaPath,
  channelClass,
  chartFrame,
  compact,
  linePath,
  percent,
  placeSegments,
  project,
  shareSegments,
} from "./surfaceData";

it("places segments left to right and leaves headroom against a larger total", () => {
  const placed = placeSegments(
    [
      { id: "a", label: "A", value: 30 },
      { id: "b", label: "B", value: 20 },
    ],
    100
  );
  expect(placed.map((p) => [p.start, p.width])).toEqual([
    [0, 30],
    [30, 20],
  ]);
  const full = placeSegments([
    { id: "a", label: "A", value: 1 },
    { id: "b", label: "B", value: 3 },
  ]);
  expect(full.map((p) => p.width)).toEqual([25, 75]);
  expect(placeSegments([{ id: "a", label: "A", value: 0 }])).toEqual([]);
});

it("orders share segments heaviest first and drops empty shares", () => {
  const segments = shareSegments({ fishing: 0.6, farming: 0.4, grazing: 0 }, (id) =>
    id.toUpperCase()
  );
  expect(segments.map((s) => s.id)).toEqual(["fishing", "farming"]);
  expect(segments[0].label).toBe("FISHING");
});

it("frames series on a shared axis with y from zero and projects points", () => {
  const frame = chartFrame(
    [
      {
        id: "p",
        label: "People",
        points: [
          { x: 10, y: 900 },
          { x: 20, y: 1000 },
        ],
      },
      {
        id: "c",
        label: "Capacity",
        points: [
          { x: 10, y: 1200 },
          { x: 20, y: 1500 },
        ],
      },
    ],
    100,
    40
  )!;
  expect(frame).toMatchObject({ xMin: 10, xMax: 20, yMax: 1500 });
  expect(project(frame, { x: 20, y: 1500 })).toEqual({ x: 100, y: 0 });
  expect(project(frame, { x: 10, y: 0 })).toEqual({ x: 0, y: 40 });
  expect(chartFrame([], 100, 40)).toBeNull();
  // A single point still draws, centred.
  const single = chartFrame([{ id: "p", label: "P", points: [{ x: 5, y: 2 }] }], 100, 40)!;
  expect(project(single, { x: 5, y: 2 })).toEqual({ x: 50, y: 0 });
});

it("draws line and area paths in frame space", () => {
  const series = {
    id: "p",
    label: "P",
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
  };
  const frame = chartFrame([series], 100, 50)!;
  expect(linePath(frame, series)).toBe("M0.0 50.0 L100.0 0.0");
  expect(areaPath(frame, series)).toBe("M0.0 50.0 L100.0 0.0 L100.0 50 L0.0 50 Z");
});

it("labels numbers compactly and channels by fixed class", () => {
  expect(compact(850)).toBe("850");
  expect(compact(1234)).toBe("1.2k");
  expect(compact(45678)).toBe("46k");
  expect(compact(2_100_000)).toBe("2.1M");
  expect(percent(0.256)).toBe("26%");
  expect(percent(0.256, 1)).toBe("25.6%");
  expect(channelClass("farming", 3)).toBe("ch-farming");
  expect(channelClass("River speech", 9)).toBe("ch-1");
});
