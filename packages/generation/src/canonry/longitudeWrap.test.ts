import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { createField, type PhysicalField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { atmosphericFlow } from "./atmosphere";
import { moisture } from "./climate";
import { oceanCurrents } from "./currents";
import { wrappedEdges } from "./longitudeWrap";
import { units } from "./math";

const width = 2_000_000,
  height = 600_000;
// A world-wide band at 12°–18° in the trades, which blow from the east. Land
// covers both edges, so air leaving the west edge crosses into the east edge.
function band(
  wrapLongitude: number,
  bounds: [number, number, number, number] = [0, 0, width, height]
) {
  const map = createField(createWorldMesh(bounds, 6000, 50_000));
  const c = physicalContext(
    42,
    0,
    atlasPhysicalProfile({
      southLatitude: 12,
      northLatitude: 18,
      latitudeProjection: 0,
      wrapLongitude,
    })
  );
  c.Profile.WorldExtentX = [0, width];
  c.Profile.WorldExtentY = [0, height];
  c.Profile.CirculationWander = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x[i] + map.mesh.origin[0],
      land = x < 300_000 || x > 1_500_000;
    map.WaterKindCodes[i] = land ? 0 : 1;
    map.WaterDepths[i] = land ? 0 : units(3000);
    map.Elevation[i] = units(land ? 100 : -3000);
    map.OceanDistance[i] = land ? 100_000 : -1;
    map.Temperature[i] = 550;
  }
  atmosphericFlow(map, c);
  moisture(map, c);
  return { map, c };
}
/** Mean of `values` over content cells within 30 km of a world x, away from the north and south edges. */
function near(map: PhysicalField, values: ArrayLike<number>, x: number) {
  let total = 0,
    count = 0;
  for (let i = 0; i < map.mesh.contentCount; i++) {
    const wx = map.mesh.x[i] + map.mesh.origin[0],
      wy = map.mesh.y[i] + map.mesh.origin[1];
    if (Math.abs(wx - x) < 30_000 && wy > 150_000 && wy < 450_000) {
      total += values[i];
      count++;
    }
  }
  return total / count;
}

it("carries air leaving the west edge into the east edge", () => {
  const open = band(0).map,
    wrapped = band(1).map;
  // Humidity change across the seam: 80 km of travel from 40 km inside the west
  // edge to 40 km inside the east edge.
  const seam = (map: PhysicalField) =>
    Math.abs(near(map, map.Moisture, width - 40_000) - near(map, map.Moisture, 40_000));
  // Open edges start the east column from a half-saturated boundary; wrapped
  // air arrives as the west edge left it, drying only as it does over any
  // 100 km of the same land.
  const drying = Math.abs(
    near(wrapped, wrapped.Moisture, 140_000) - near(wrapped, wrapped.Moisture, 40_000)
  );
  expect(seam(wrapped)).toBeLessThan(seam(open) / 3);
  expect(seam(wrapped)).toBeLessThan(drying * 1.2);
});

it("leaves an open-edged world and a region of a wrapping world unchanged", () => {
  const open = band(0),
    region = band(1, [400_000, 0, 1_400_000, height]);
  expect(wrappedEdges(open.map, open.c.Profile)).toBeNull();
  expect(wrappedEdges(region.map, region.c.Profile)).toBeNull();
  expect(wrappedEdges(band(1).map, band(1).c.Profile)).toEqual([0, width]);
});

it("carries the sea-surface anomaly around a world-wide ocean", () => {
  const sea = (wrapLongitude: number) => {
    const { map, c } = band(wrapLongitude);
    for (let i = 0; i < map.mesh.count; i++) {
      map.WaterKindCodes[i] = 1;
      map.WaterDepths[i] = units(3000);
      map.Elevation[i] = units(-3000);
    }
    oceanCurrents(map, c);
    return map;
  };
  const wrapped = sea(1);
  // Westward drift: water at the west edge continues at the east edge.
  expect(near(wrapped, wrapped.OceanCurrentX, width / 2)).toBeLessThan(0);
  expect(
    Math.abs(
      near(wrapped, wrapped.SeaSurfaceAnomaly, width - 40_000) -
        near(wrapped, wrapped.SeaSurfaceAnomaly, 40_000)
    )
  ).toBeLessThan(2);
});
