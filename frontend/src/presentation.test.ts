import { describe, expect, it } from "vitest";
import { bounds, frameAt, rectangle, lineage } from "./presentation";
import type { World } from "./types";

describe("geographic presentation", () => {
  it("uses geographic extents with no synthetic detail from zoom", () => {
    expect(bounds(rectangle(123, 456, 1000, 2000))).toEqual([123, 456, 1123, 2456]);
    expect(frameAt(10, 20, -3, 90, "cellar").origin.z).toBe(-3);
  });
  it("shows geographic ancestry through skipped profiles", () => {
    const world = {
      areas: {
        root: { id: "root", parentId: null },
        site: { id: "site", parentId: "root" },
        interior: { id: "interior", parentId: "site" },
      },
    } as unknown as World;
    expect(lineage(world, "interior").map((a) => a.id)).toEqual(["root", "site", "interior"]);
  });
});
