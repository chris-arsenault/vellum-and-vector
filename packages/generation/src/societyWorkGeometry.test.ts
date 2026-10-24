import { expect, it } from "vitest";
import { societyWorkNatures, type SocietyWork } from "@atlas/domain";
import { landscape } from "./mapFixtures";
import { societyWorkGeometry } from "./societyWorkGeometry";

it("distinguishes all fourteen work kinds without inventing structure footprints or sub-mesh activity areas", () => {
  const state = landscape();
  for (const kind of Object.keys(societyWorkNatures) as SocietyWork["kind"][]) {
    const w: SocietyWork = {
      id: kind,
      kind,
      communityId: "c",
      position: { x: 2000, y: 500, z: 0 },
      radius: 1000,
      magnitude: 1,
      condition: 1,
      maintained: true,
      authored: false,
      built: "Era",
      applied: 0,
      causes: [],
    };
    const shape = societyWorkGeometry(state, w);
    if (societyWorkNatures[kind].nature === "intensive")
      expect(shape.geometry.type).toMatch(/Polygon/);
    else expect(shape.geometry.type).toBe("Point");
    expect(societyWorkGeometry(state, { ...w, radius: 0.1 }).geometry.type).toBe("Point");
  }
});
