import { expect, it, vi } from "vitest";
import { MapScale } from "@atlas/domain";
import { withFloodFloor } from "./riverMeanders";

const scale = MapScale.fromBounds([0, 0, 4_000_000, 3_000_000], 6400);

it("reads flood relief against the nearest station's bed and reuses a visited mask cell", () => {
  const height = vi.fn((x: number, y: number) => x / 10 + y / 10);
  withFloodFloor(
    {
      scale,
      valley: [
        [0, 0],
        [1000, 0],
      ],
      height,
      relief: 10,
      width: 400,
    },
    (floor) => {
      expect(floor([0, 0])).toBe(true);
      const calls = height.mock.calls.length;
      expect(floor([25, 25])).toBe(true);
      expect(height.mock.calls.length).toBe(calls);
      expect(floor([0, 200])).toBe(false);
      expect(floor([900, 0])).toBe(true);
    }
  );
});

it("samples narrow bank room more finely than a wide channel", () => {
  const at = (width: number) => {
    const height = vi.fn(() => 0);
    withFloodFloor({ scale, valley: [[0, 0]], height, relief: 0, width }, (floor) => {
      floor([25, 25]);
    });
    return height.mock.calls.at(-1);
  };
  expect(at(100)).toEqual([37.5, 37.5]);
  expect(at(400)).toEqual([50, 50]);
});

it("keeps sparse visited pages across distant and negative coordinates without a search belt", () => {
  const height = vi.fn(() => 0);
  withFloodFloor(
    {
      scale,
      valley: [
        [-100_000_000, -100_000_000],
        [100_000_000, 100_000_000],
      ],
      height,
      relief: 1,
      width: 400,
    },
    (floor) => {
      for (const point of [
        [-100_000_000, -100_000_000],
        [0, 0],
        [100_000_000, 100_000_000],
      ] as [number, number][])
        expect(floor(point)).toBe(true);
      expect(height).toHaveBeenCalledTimes(5);
      expect(floor([-99_999_975, -99_999_975])).toBe(true);
      expect(height).toHaveBeenCalledTimes(5);
    }
  );
});

it("does not share a previous migration's floor values", () => {
  const input = { scale, valley: [[0, 0]] as [number, number][], relief: 1, width: 400 };
  expect(withFloodFloor({ ...input, height: () => 0 }, (floor) => floor([0, 0]))).toBe(true);
  expect(withFloodFloor({ ...input, height: (x) => x }, (floor) => floor([0, 0]))).toBe(false);
});
