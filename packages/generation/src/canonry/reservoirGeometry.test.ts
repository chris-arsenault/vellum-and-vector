import { expect, it } from "vitest";
import { point, spatial } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { preparePhysicalChannels } from "./continuousState";
import { drainageConditioning } from "./drainageFlood";
import { lakeBasins } from "./lakes";
import { lakeFootprint } from "./geographicContours";
import { nearestTriangle } from "./mesh";

function reservoirLandscape(samples: number) {
  const state = landscape(),
    map = createField(createWorldMesh(state.surface.bounds, samples, 0)),
    profile = atlasPhysicalProfile();
  state.physical = {
    map,
    profile,
    samples: new Int32Array(),
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 1000, minimumSize: 1000, featureSamples: 2 },
  };
  map.mesh.openBoundary = false;
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x[i],
      y = map.mesh.y[i];
    map.Elevation[i] =
      1024 * (10 - (x / 500) ** 2 + 10 * (y / 200) ** 2 + 10 * (Math.max(0, -x - 1000) / 200) ** 2);
    if (x > 1200 && map.Elevation[i] < 0) {
      map.WaterKindCodes[i] = 1;
      map.WaterSurfaceElevations[i] = 0;
    }
  }
  map.Runoff.fill(10000);
  map.Rainfall.fill(4000);
  map.Temperature.fill(450);
  profile.MinimumLakeArea = 0;
  profile.LakeDepthThreshold = 0;
  profile.LakeCompactnessShare = 0;
  preparePhysicalChannels(map, ["Elevation"]);
  const context = physicalContext(42, 0, profile);
  drainageConditioning(map, context);
  lakeBasins(map, context);
  return state;
}

it("keeps a spilling reservoir upstream of its terrain-controlled outlet", () => {
  const state = reservoirLandscape(256),
    map = state.physical!.map;
  const seed = nearestTriangle(map.mesh, -700, 0),
    body = map.WaterBodyIds[seed],
    stage = map.WaterSurfaceElevations[seed],
    members = Array.from(map.WaterBodyIds.keys()).filter((i) => map.WaterBodyIds[i] === body);
  expect(body).toBeGreaterThan(1);
  expect(map.WaterKindCodes[nearestTriangle(map.mesh, 1800, 0)]).toBe(1);
  const footprint = lakeFootprint(state, members, body, stage)!;
  expect(spatial.covers(footprint, point({ x: 1300, y: 500, z: 0 }))).toBe(true);
  expect(spatial.covers(footprint, point({ x: 3800, y: 500, z: 0 }))).toBe(false);
  expect(map.WaterSurfaceElevations[seed]).toBe(stage);
});

it.each([128, 256])(
  "publishes every reservoir without claiming downstream members at %i samples",
  (samples) => {
    const state = reservoirLandscape(samples),
      map = state.physical!.map,
      ids = [...new Set(map.WaterBodyIds)].filter((id) => id > 1);
    for (const body of ids) {
      const members = Array.from(map.WaterBodyIds.keys()).filter(
          (i) => map.WaterBodyIds[i] === body
        ),
        shape = lakeFootprint(state, members, body, map.WaterSurfaceElevations[members[0]])!;
      expect(shape).not.toBeNull();
      const covers = spatial.pointCoverage(shape);
      for (const i of map.WaterBodyIds.keys()) {
        if (map.WaterKindCodes[i] === 0) continue;
        expect(
          covers({
            x: map.mesh.x[i] + map.mesh.origin[0],
            y: map.mesh.y[i] + map.mesh.origin[1],
            z: 0,
          })
        ).toBe(map.WaterBodyIds[i] === body);
      }
    }
  }
);
