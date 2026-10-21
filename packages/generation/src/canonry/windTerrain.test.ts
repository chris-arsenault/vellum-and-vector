import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { createField, type PhysicalField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { atmosphericFlow, beltSpeed, circulation } from "./atmosphere";
import { units } from "./math";

// A 400 km square at 40° latitude, in the westerlies, with wander removed.
function landscape(height: (x: number, y: number) => number) {
  const map = createField(createWorldMesh([-200_000, -200_000, 200_000, 200_000], 6400, 40_000));
  for (let i = 0; i < map.mesh.count; i++)
    map.Elevation[i] = units(100 + height(map.mesh.x[i], map.mesh.y[i]));
  const c = physicalContext(42, 0, atlasPhysicalProfile());
  c.Profile.CirculationWander = 0;
  atmosphericFlow(map, c);
  return map;
}
function nearest(map: PhysicalField, x: number, y: number) {
  let best = 0;
  for (let i = 0; i < map.mesh.contentCount; i++)
    if (
      Math.hypot(map.mesh.x[i] - x, map.mesh.y[i] - y) <
      Math.hypot(map.mesh.x[best] - x, map.mesh.y[best] - y)
    )
      best = i;
  return best;
}
const ridge = (x: number) => 2500 * Math.exp(-((x / 30_000) ** 2));

it("anchors wind belts to latitude in both hemispheres", () => {
  const p = atlasPhysicalProfile();
  expect(circulation(p, 15)[0]).toBe(-1);
  expect(circulation(p, 15)[1]).toBeLessThan(0); // Northern trades blow toward the equator.
  expect(circulation(p, -15)[1]).toBeGreaterThan(0);
  expect(circulation(p, 45)[0]).toBe(1);
  expect(circulation(p, 45)[1]).toBeGreaterThan(0); // Westerlies drift poleward.
  expect(circulation(p, 75)[0]).toBe(-1);
  expect(beltSpeed(p, 45)).toBeGreaterThan(beltSpeed(p, 30));
});

it("shelters the lee of a high ridge and turns windward flow along it", () => {
  const map = landscape((x) => ridge(x));
  const upstream = nearest(map, -170_000, 0),
    windward = nearest(map, -25_000, 0),
    lee = nearest(map, 60_000, 0);
  expect(map.WindX[upstream]).toBeGreaterThan(0);
  expect(map.WindSpeed[lee]).toBeLessThan(map.WindSpeed[upstream] * 0.7);
  // Part of the upslope (eastward) flow turns along the ridge on the windward slope.
  expect(map.WindX[windward]).toBeLessThan(map.WindX[upstream] * 0.9);
  expect(map.WindY[windward]).toBeGreaterThan(map.WindY[upstream] + 100);
});

it("channels wind through a gap in a ridge", () => {
  const map = landscape((x, y) => ridge(x) * (Math.abs(y) < 20_000 ? 0.05 : 1));
  const open = nearest(map, -170_000, 0),
    gap = nearest(map, 0, 0);
  expect(map.WindSpeed[gap]).toBeGreaterThan(map.WindSpeed[open] * 1.15);
});
