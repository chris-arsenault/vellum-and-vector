import { describe, expect, it } from "vitest";
import {
  authoredTools,
  buildHeightArea,
  buildHeightLine,
  buildPeak,
  buildStroke,
  clampRadius,
  defaultAuthored,
  formatMetres,
  interactionFor,
  isBrush,
  radiusFromSlider,
  radiusRange,
  sliderFromRadius,
  thinPoints,
  toolByKey,
  toolGroupsFor,
  toolsFor,
} from "./authoredState";

const bounds: [number, number, number, number] = [0, 0, 100_000, 50_000];

describe("tools", () => {
  it("has one key per tool and finds a tool by its key in either case", () => {
    const keys = authoredTools.map((tool) => tool.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(toolByKey("l")?.id).toBe("landmass");
    expect(toolByKey("L")?.id).toBe("landmass");
  });
  it("maps every tool to a canvas interaction and recognises the brushes", () => {
    expect(interactionFor("landmass")).toBe("draw");
    expect(interactionFor("river")).toBe("draw");
    expect(interactionFor("place")).toBe("draw");
    expect(interactionFor("smooth")).toBe("brush");
    expect(interactionFor("peak")).toBe("peak");
    expect(authoredTools.filter((tool) => isBrush(tool.id)).map((tool) => tool.id)).toEqual([
      "raise",
      "lower",
      "smooth",
      "flatten",
      "set",
    ]);
  });
});
describe("tools per profile", () => {
  const ids = (profile: string) => toolsFor(profile).map((tool) => tool.id);
  it("gives a world and a region land, relief and water, plus Edit and Places", () => {
    for (const profile of ["world", "region"]) {
      expect(toolGroupsFor(profile)).toEqual(["Edit", "Land", "Elevation", "Water", "Places"]);
      expect(ids(profile)).toContain("raise");
      expect(ids(profile)).not.toContain("street");
    }
  });
  it("gives a city streets and parcels instead of land and relief", () => {
    expect(toolGroupsFor("local")).toEqual(["Edit", "Streets & parcels", "Places"]);
    expect(ids("local")).toEqual(["select", "points", "street", "building", "plot", "place"]);
  });
  it("keeps every key unique across both sets", () => {
    const keys = authoredTools.map((tool) => tool.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(interactionFor("street")).toBe("street");
    expect(interactionFor("building")).toBe("building");
    expect(interactionFor("plot")).toBe("draw");
  });
});
describe("brush radius", () => {
  it("clamps into a range scaled to the map and survives a bad value", () => {
    const [least, most] = radiusRange(bounds);
    expect(clampRadius(0, bounds)).toBe(least);
    expect(clampRadius(1e12, bounds)).toBe(most);
    expect(clampRadius(Number.NaN, bounds)).toBe(least);
    expect(clampRadius(2_000, bounds)).toBe(2_000);
  });
  it("round-trips through the logarithmic slider", () => {
    for (const radius of [100, 2_000, 15_000]) {
      const back = radiusFromSlider(sliderFromRadius(radius, bounds), bounds);
      expect(back).toBeCloseTo(radius, 4);
    }
    expect(radiusFromSlider(-1, bounds)).toBe(radiusRange(bounds)[0]);
    expect(radiusFromSlider(2, bounds)).toBe(radiusRange(bounds)[1]);
  });
  it("reads lengths in metres or kilometres", () => {
    expect(formatMetres(850)).toBe("850 m");
    expect(formatMetres(1500)).toBe("1.5 km");
    expect(formatMetres(25_000)).toBe("25 km");
  });
});
describe("strokes", () => {
  const brush = { radius: 40, strength: 0.6, target: 120, stepHeight: 5 };
  it("thins a dragged path to a quarter of the radius, keeping both ends", () => {
    const path: [number, number][] = Array.from({ length: 101 }, (_, i) => [i, 0]);
    const thin = thinPoints(path, 10);
    expect(thin[0]).toEqual([0, 0]);
    expect(thin.at(-1)).toEqual([100, 0]);
    expect(thin.length).toBeLessThan(15);
  });
  it("builds one stroke carrying the brush settings", () => {
    const stroke = buildStroke(
      [
        [0, 0],
        [100, 0],
      ],
      "flatten",
      brush
    );
    expect(stroke).toEqual({
      points: [
        [0, 0],
        [100, 0],
      ],
      radius: 40,
      strength: 0.6,
      mode: "flatten",
      target: 120,
      stepHeight: 5,
    });
  });
  it("keeps a single click as a one-dab stroke", () => {
    expect(buildStroke([[5, 5]], "raise", brush).points).toEqual([[5, 5]]);
  });
});
describe("height shapes", () => {
  const shape = { height: 800, halfWidth: 300, feather: 900, peakRadius: 2000 };
  it("gives each line vertex the field's height unless one was set when clicked", () => {
    const line = buildHeightLine(
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
      shape,
      [100, 200]
    );
    expect(line.heights).toEqual([100, 200, 800]);
    expect(line.halfWidth).toBe(300);
  });
  it("closes an open ring and leaves a closed one alone", () => {
    const open: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 4],
    ];
    expect(buildHeightArea(open, shape).rings[0]).toHaveLength(4);
    expect(buildHeightArea(open, shape).rings[0][3]).toEqual([0, 0]);
    const closed = [...open, [0, 0] as [number, number]];
    expect(buildHeightArea(closed, shape).rings[0]).toHaveLength(4);
    expect(buildHeightArea(closed, shape)).toMatchObject({ height: 800, feather: 900 });
  });
  it("builds a peak from a click", () => {
    expect(buildPeak([7, 9], shape)).toEqual({ at: [7, 9], height: 800, radius: 2000 });
  });
  it("starts with sizes scaled to the map", () => {
    const start = defaultAuthored(bounds);
    expect(start.tool).toBe("select");
    expect(start.brush.radius).toBe(2_500);
  });
});
