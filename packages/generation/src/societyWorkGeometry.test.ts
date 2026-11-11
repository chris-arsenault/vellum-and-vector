import { expect, it } from "vitest";
import {
  canonicalGeometry,
  createGrid,
  rectangle,
  societyWorkNatures,
  spatial,
  type Bounds,
  type SocietyWork,
} from "@atlas/domain";
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

it("publishes activity areas on both sides of a compact seam frame", () => {
  const state = landscape(),
    bounds: Bounds = [3600, 100, 4400, 900],
    reference = state.domain.world.reference;
  reference.boundaryMode = "cylinder";
  const footprint = canonicalGeometry(reference, rectangle(bounds));
  state.domain.scope.footprint = footprint;
  state.surface = createGrid("seam", state.domain.scope, 9, 9, bounds, undefined, 4000);
  const work: SocietyWork = {
    id: "fields",
    kind: "clearance",
    communityId: "c",
    position: { x: 4050, y: 500, z: 0 },
    radius: 200,
    magnitude: 1,
    condition: 1,
    maintained: true,
    authored: false,
    built: "Era",
    applied: 0,
    causes: [],
  };
  const shape = societyWorkGeometry(state, work).geometry,
    covers = spatial.pointCoverage(shape);
  expect(shape.type).toMatch(/Polygon/);
  expect(covers({ x: 50, y: 500, z: 0 })).toBe(true);
  expect(covers({ x: 3950, y: 500, z: 0 })).toBe(true);
  expect(spatial.covers(footprint, shape)).toBe(true);
});
