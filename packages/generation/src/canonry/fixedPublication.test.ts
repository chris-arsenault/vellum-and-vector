import { expect, it } from "vitest";
import {
  createGrid,
  gridPosition,
  fieldInterpolator,
  rectangle,
  point,
  spatial,
} from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createAtlasWorkspace } from "./atlasWorkspace";
import { projectNative } from "./atlasProjection";
import { initializeMagic } from "./magicState";
import { projectMagic } from "./magicFeatures";
import { membershipContour, membershipSampler } from "./geographicContours";
import { nearestTriangle } from "./mesh";

it("publishes a fixed triangle world as continuous metre channels and discrete material/magic fields", () => {
  const state = landscape();
  state.surface = createGrid("fixed", state.domain.scope, 23, 19);
  state.physical = createAtlasWorkspace(state, "draft");
  const work = state.physical!,
    mesh = work.map.mesh;
  expect(mesh.topology).toBeNull();
  for (let i = 0; i < mesh.count; i++) {
    work.map.Elevation[i] = (500 + mesh.x[i] * 0.002) * 1024;
    work.map.BedrockElevation[i] = work.map.Elevation[i] - 10 * 1024;
    work.map.SedimentThickness[i] = 10 * 1024;
    work.map.CrustProvinceIds[i] = i % 5;
  }
  initializeMagic(state);
  work.magic!.fields[0].intensity.fill(700);
  work.magic!.fields[0].retained.set(Float64Array.from(mesh.areas, (area) => area * 7));
  projectNative(state);
  projectMagic(state);
  for (let i = 0; i < state.surface.active.length; i++) {
    const p = gridPosition(state.surface, i);
    expect(state.surface.channels.elevation[i]).toBeCloseTo(
      500 + (p.x - mesh.origin[0]) * 0.002,
      7
    );
    expect(state.surface.channels.bedrock[i] + state.surface.channels.sediment[i]).toBeCloseTo(
      state.surface.channels.elevation[i],
      7
    );
    expect(Number.isInteger(state.surface.channels.province[i])).toBe(true);
    expect(state.surface.channels["magic:fire:retained"][i]).toBeCloseTo(
      state.surface.measures[i] * 7,
      5
    );
  }
  const at = fieldInterpolator(state.surface, "elevation");
  const p = gridPosition(state.surface, 42);
  expect(at({ ...p, x: p.x + 1 })).toBeCloseTo(500 + (p.x + 1 - mesh.origin[0]) * 0.002, 7);
  expect(Object.keys(state.surface.channels).some((name) => name.startsWith("magic:"))).toBe(true);
});

it("keeps adjacent classified regions connected across faces and separates distant regions", () => {
  const state = landscape();
  state.domain.scope.footprint = rectangle([0, 0, 200_000, 200_000]);
  state.surface = createGrid("regions", state.domain.scope, 32, 32);
  state.physical = createAtlasWorkspace(state, "draft");
  const mesh = state.physical.map.mesh,
    a = nearestTriangle(mesh, 0, 0),
    b = mesh.neighbors[a * 3],
    distant = nearestTriangle(mesh, 60_000, 60_000),
    members = [a, b, distant],
    includes = (cell: number) => Number(members.includes(cell)),
    at = membershipSampler(state, includes),
    shape = membershipContour(state, members, includes)!;
  expect(shape.type).toBe("MultiPolygon");
  const p = {
    x: mesh.origin[0] + (mesh.x[a] + mesh.x[b]) / 2,
    y: mesh.origin[1] + (mesh.y[a] + mesh.y[b]) / 2,
    z: 0,
  };
  expect(at(p.x, p.y)).toBeCloseTo(1, 8);
  expect(spatial.covers(shape, point(p))).toBe(true);
  for (const cell of members)
    expect(
      spatial.covers(
        shape,
        point({ x: mesh.x[cell] + mesh.origin[0], y: mesh.y[cell] + mesh.origin[1], z: 0 })
      )
    ).toBe(true);
  expect(spatial.covers(shape, point({ x: 130_000, y: 130_000, z: 0 }))).toBe(false);
});
