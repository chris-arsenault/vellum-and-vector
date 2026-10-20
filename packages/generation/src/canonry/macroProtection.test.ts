import { expect, it } from "vitest";
import { createGrid, rectangle, putChannel, fieldInterpolator } from "@atlas/domain";
import { macroFixture } from "./macroFixtures";
import {
  protectFinishing,
  addTerrainProfile,
  bakeFinishedTerrain,
  finishedElevation,
} from "./macroTerrain";
import { projectNative } from "./atlasProjection";

it("protects the complete authored footprint from a nearby profile, including space between mesh centres", () => {
  const state = macroFixture(),
    work = state.physical!,
    footprint = rectangle([-1000, -1000, 1000, 1000]),
    patch = createGrid("protected", { ...state.domain.scope, footprint }, 3, 3);
  putChannel(patch, "elevation", "metre", new Float64Array(9).fill(1600));
  state.domain.numerical.protected = patch;
  state.domain.fieldPatches.push({
    id: "protected",
    fieldId: "terrain",
    resourceId: "protected",
    areaId: state.domain.scope.areaId,
    spaceId: state.domain.scope.spaceId,
    footprint,
    channels: ["elevation"],
    actor: "creator",
    protected: true,
    createdVersion: 1,
  });
  const before = finishedElevation(work)(200, 200);
  protectFinishing(state);
  addTerrainProfile(work, {
    id: "nearby-valley",
    points: [[0, 0]],
    widths: [20_000],
    values: { elevation: [0] },
    operation: "lower",
  });
  bakeFinishedTerrain(work);
  projectNative(state);
  const height = fieldInterpolator(state.surface, "elevation");
  expect(height({ x: 200, y: 200, z: 0 })).toBe(1600);
  expect(height({ x: 1500, y: 200, z: 0 }) * 1024).toBeLessThan(before);
});
