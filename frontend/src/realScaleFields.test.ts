import { describe, expect, it } from "vitest";
import { evaluate, parseAngle, parseLength, showLength } from "./realScaleFields";
import { snapToGuides, type Box } from "./realScaleGuides";

describe("real-scale geometry fields", () => {
  it("reads arithmetic and refuses anything else", () => {
    expect(evaluate("1.5*2+1")).toBe(4);
    expect(evaluate("(1+2)*-2")).toBe(-6);
    expect(evaluate("2+")).toBeNull();
    expect(evaluate("alert(1)")).toBeNull();
  });
  it("reads lengths with units, in the viewer's units, or relative to the current value", () => {
    expect(parseLength("240 cm", 0, "metres")).toBeCloseTo(2.4);
    expect(parseLength("10", 0, "feet")).toBeCloseTo(3.048);
    expect(parseLength("10 ft", 0, "metres")).toBeCloseTo(3.048);
    expect(parseLength("*2", 1.5, "metres")).toBe(3);
    expect(parseLength("/3", 3, "metres")).toBe(1);
    expect(parseLength("+50cm", 1, "metres")).toBeCloseTo(1.5);
    expect(parseLength("2*3 m", 0, "feet")).toBe(6);
    expect(parseLength("", 1, "metres")).toBeNull();
  });
  it("reads angles absolutely or as a turn", () => {
    expect(parseAngle("45", 30)).toBe(45);
    expect(parseAngle("+15", 30)).toBe(45);
    expect(parseAngle("90°", 0)).toBe(90);
  });
  it("shows lengths in the viewer's units", () => {
    expect(showLength(3.048, "feet")).toBe("10 ft");
    expect(showLength(2.345, "metres")).toBe("2.35 m");
  });
});

describe("alignment guides", () => {
  const moving: Box = [10.2, 0, 12.2, 2];
  it("lines an edge up with a nearby box and draws the guide", () => {
    const snapped = snapToGuides(moving, [[10, 5, 14, 7]], 0.5);
    expect(snapped.dx).toBeCloseTo(-0.2);
    expect(snapped.guides[0]).toMatchObject({ axis: "x", at: 10 });
  });
  it("leaves equal gaps between the neighbours on either side", () => {
    const snapped = snapToGuides(
      [5.3, 0, 7.3, 2],
      [
        [0, 0.5, 2, 1.5],
        [10, 0.5, 12, 1.5],
      ],
      0.5
    );
    expect(snapped.dx).toBeCloseTo(-0.3);
    expect(snapped.guides.some((guide) => guide.axis === "x")).toBe(true);
  });
  it("leaves a box alone when nothing is near", () => {
    expect(snapToGuides(moving, [[50, 50, 52, 52]], 0.5)).toEqual({ dx: 0, dy: 0, guides: [] });
  });
});
