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
    map.Elevation.set(i, units(100 + height(map.mesh.x(i), map.mesh.y(i))));
  // Without a world frame the map sits at the mid latitude: 40° with even degrees.
  const c = physicalContext(42, 0, atlasPhysicalProfile({ latitudeProjection: 0 }));
  c.Profile.CirculationWander = 0;
  atmosphericFlow(map, c);
  return map;
}
/** The content cell nearest the point; among equidistant cells, the one on the row nearest y. */
function nearest(map: PhysicalField, x: number, y: number) {
  let best = -1;
  const rank = (i: number) => [
    Math.round(Math.hypot(map.mesh.x(i) - x, map.mesh.y(i) - y)),
    Math.abs(map.mesh.y(i) - y),
  ];
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.membership(i) !== 1) continue;
    if (best < 0) {
      best = i;
      continue;
    }
    const [d, dy] = rank(i),
      [bd, bdy] = rank(best);
    if (d < bd || (d === bd && dy < bdy)) best = i;
  }
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
  expect(map.WindX.get(upstream)).toBeGreaterThan(0);
  expect(map.WindSpeed.get(lee)).toBeLessThan(map.WindSpeed.get(upstream) * 0.7);
  // Part of the upslope (eastward) flow turns along the ridge on the windward slope.
  expect(map.WindX.get(windward)).toBeLessThan(map.WindX.get(upstream) * 0.9);
  expect(map.WindY.get(windward)).toBeGreaterThan(map.WindY.get(upstream) + 100);
});

it("channels wind through a gap in a ridge", () => {
  const map = landscape((x, y) => ridge(x) * (Math.abs(y) < 20_000 ? 0.05 : 1));
  const open = nearest(map, -170_000, 0),
    gap = nearest(map, 0, 0);
  expect(map.WindSpeed.get(gap)).toBeGreaterThan(map.WindSpeed.get(open) * 1.15);
});
