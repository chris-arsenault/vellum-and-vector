import { describe, expect, it } from "vitest";
import { rectangle } from "@atlas/domain";
import { linkObservedFootprints } from "./wildZoneHistory";

const observed = (id: string, west: number, east: number) => ({
  id,
  name: id,
  geometry: rectangle([west, 0, east, 10]),
});
describe("surveyed wild-zone identity", () => {
  it("links a displaced footprint through actual shared ground", () => {
    const old = observed("original", 0, 10),
      current = observed("new", 5, 15);
    expect(linkObservedFootprints([old], [current])[0]).toEqual({
      ...current,
      id: old.id,
      name: old.name,
    });
    expect(current.id).toBe("new");
  });
  it("does not invent a trajectory between disjoint or merely touching patches", () => {
    const current = [observed("touching", 10, 20), observed("remote", 30, 40)];
    expect(linkObservedFootprints([observed("gone", 0, 10)], current)).toEqual(current);
  });
  it("retains only the largest overlapping successor when a zone splits", () => {
    const linked = linkObservedFootprints(
      [observed("old", 0, 10)],
      [observed("small", 0, 2), observed("large", 3, 10)]
    );
    expect(linked.map((p) => p.id)).toEqual(["small", "old"]);
  });
  it("does not resurrect an ended lineage after an empty survey", () => {
    expect(linkObservedFootprints([], [observed("new", 0, 10)])[0].id).toBe("new");
    expect(linkObservedFootprints([observed("old", 0, 10)], [])).toEqual([]);
  });
  it("keeps only the largest predecessor when zones merge", () => {
    expect(
      linkObservedFootprints(
        [observed("small", 0, 2), observed("large", 3, 10)],
        [observed("merged", 0, 10)]
      )[0].id
    ).toBe("large");
  });
});
