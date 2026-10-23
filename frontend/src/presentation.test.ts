import { describe, expect, it } from "vitest";
import { bounds, frameAt, rectangle, lineage, defaultStyles } from "./presentation";
import { createWorld } from "./atlasState";
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
  it("keeps fault traces available as an explicit overlay without mixing them into surface landforms", () => {
    const world = createWorld({ name: "Geology", seed: 1, width: 100_000, height: 100_000 }),
      styles = defaultStyles(world);
    expect(world.layers.faults.name).toBe("Fault traces");
    expect(styles.find((style) => style.layerId === "faults")?.visible).toBe(false);
    expect(styles.find((style) => style.layerId === "geology")?.visible).toBe(true);
  });
  it("separates society overlays and enables practices with the magical preset", () => {
    const world = createWorld({ name: "Society", seed: 1, width: 1000, height: 1000 });
    expect(defaultStyles(world).find((s) => s.layerId === "waterworks")?.visible).toBe(false);
    expect(
      defaultStyles(world, "infrastructure").find((s) => s.layerId === "waterworks")?.visible
    ).toBe(true);
    expect(
      defaultStyles(world, "magical").find((s) => s.layerId === "magicPractices")?.visible
    ).toBe(true);
    expect(
      defaultStyles(world, "cultural").find((s) => s.layerId === "institutions")?.visible
    ).toBe(true);
  });
  it("shows magical geography on the physical map without switching presets", () => {
    const world = createWorld({ name: "Magic", seed: 1, width: 1000, height: 1000 });
    for (const preset of ["physical", "infrastructure", "magical"])
      expect(defaultStyles(world, preset).find((s) => s.layerId === "magic")?.visible).toBe(true);
    expect(defaultStyles(world, "political").find((s) => s.layerId === "magic")?.visible).toBe(
      false
    );
  });
});
