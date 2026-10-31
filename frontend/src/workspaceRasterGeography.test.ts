import { expect, it } from "vitest";
import { rectangle, spatial } from "@atlas/domain";
import { generationSnapshot } from "@atlas/generation";
import { constructedWorld } from "./constructedWorldFixture";
import {
  registerWorldSnapshot,
  fixtureWorkspace,
  readMapRasters,
} from "./testSupport/workspaceFixture";
import { workspaceRasterGeography } from "./workspaceRasterGeography";

it("joins overlapping raster windows into valid ocean and lake masks", async () => {
  const f = constructedWorld();
  f.result.state.surface.ocean = rectangle([0, 0, 1500, 1000]);
  f.result.state.surface.lakes = [
    { id: "supplied-lake", geometry: rectangle([2000, 200, 3000, 800]), level: 120 },
  ];
  const snapshot = generationSnapshot(f.result, f.input, crypto.randomUUID());
  registerWorldSnapshot(snapshot);
  const { catalog } = await fixtureWorkspace(snapshot.world.id),
    rasters = await readMapRasters(snapshot.world.id, snapshot.scope.areaId),
    elevation = rasters.find((field) => field.channel === "elevation")!,
    geography = await workspaceRasterGeography(catalog, {
      ...elevation.geography!,
      windows: [
        [0, 0, 2500, 1000],
        [500, 0, 4000, 1000],
      ],
      tolerance: 0,
      revision: snapshot.world.version,
    });
  expect(spatial.area(geography.ocean!)).toBeCloseTo(1500000);
  expect(spatial.pointCoverage(geography.ocean!)({ x: 1000, y: 500, z: 0 })).toBe(true);
  expect(geography.lakes).toHaveLength(1);
  expect(spatial.area(geography.lakes[0].geometry)).toBeCloseTo(600000);
  expect(geography.lakes[0].level).toBe(120);
});
