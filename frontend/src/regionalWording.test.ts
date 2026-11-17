import { describe, expect, it } from "vitest";
import type { RealScale } from "@atlas/map";
import { wording } from "./regionalWording";

describe("refinement dialog wording", () => {
  it("names a real-scale child by its hexes and real size", () => {
    const real = { kind: "ground", acrossFlats: 1.5, feet: 5 } as RealScale;
    const words = wording(real, { width: 45, height: 33.75 });
    expect(words.title).toBe("Open a real-scale map");
    expect(words.summary).toBe("A 1.5 m (5 ft) hex ground map, 45.0 m × 33.8 m");
    expect(words.generate).toBe("Generate map");
  });
  it("names a region by its size in kilometres", () => {
    const words = wording(undefined, { width: 120_000, height: 90_000 });
    expect(words).toMatchObject({ title: "Refine region", summary: "120 × 90 km" });
  });
});
