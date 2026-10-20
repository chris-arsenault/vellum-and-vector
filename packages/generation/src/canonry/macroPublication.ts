import { fieldInterpolator, spatial } from "@atlas/domain";
import type { GenerationState } from "../process";
import { generatedFeature, putGenerated } from "../mapFeatures";
import { Landform } from "./codes";
import { coordinateKey } from "./worldSources";

/** Publish locations from composed paths, never the old triangle representatives. */
export function publishMacroFeatures(state: GenerationState) {
  const work = state.physical!,
    finishing = work.finishing;
  if (!finishing) return;
  const height = fieldInterpolator(state.surface, "elevation");
  for (const pass of finishing.passes) {
    const geometry = spatial.intersection(
      { type: "LineString", coordinates: pass.profile.points },
      state.domain.scope.footprint
    );
    if (geometry)
      putGenerated(
        state,
        generatedFeature(state, pass.id, "Mountain pass", "pass", "geology", geometry, {
          elevations: pass.profile.points.map(([x, y]) => height({ x, y, z: 0 })),
          sourceAlgorithm: "atlas-macro-finishing-1",
        })
      );
  }
  publishFalls(state);
  publishGorges(state);
  publishSummits(state);
}
function publishSummits(state: GenerationState) {
  const height = fieldInterpolator(state.surface, "elevation");
  for (const [x, y] of state.physical!.finishing!.summits) {
    const geometry = { type: "Point" as const, coordinates: [x, y] };
    if (!spatial.covers(state.domain.scope.footprint, geometry)) continue;
    putGenerated(
      state,
      generatedFeature(state, `peak:${coordinateKey(x, y)}`, "Peak", "peak", "geology", geometry, {
        elevation: height({ x, y, z: 0 }),
        sourceAlgorithm: "atlas-macro-finishing-1",
      })
    );
  }
}
function publishFalls(state: GenerationState) {
  const work = state.physical!,
    finishing = work.finishing!,
    mesh = work.map.mesh,
    height = fieldInterpolator(state.surface, "elevation");
  for (const fall of finishing.drops) {
    const p = { x: fall.point[0] + mesh.origin[0], y: fall.point[1] + mesh.origin[1], z: 0 },
      geometry = { type: "Point" as const, coordinates: [p.x, p.y] };
    if (spatial.covers(state.domain.scope.footprint, geometry))
      putGenerated(
        state,
        generatedFeature(state, fall.id, "Waterfall", "waterfall", "geology", geometry, {
          elevation: height(p),
          drop: fall.drop,
          width: work.map.RiverWidth[fall.cell],
          sourceAlgorithm: "atlas-macro-finishing-1",
        })
      );
  }
}
function publishGorges(state: GenerationState) {
  const work = state.physical!,
    finishing = work.finishing!,
    mesh = work.map.mesh,
    waters = [
      ...(finishing.ocean ? [finishing.ocean] : []),
      ...[...finishing.lakes.values()].map((lake) => lake.footprint),
    ],
    dry = waters.map((water) => spatial.differenceFrom(water));
  for (const [id, curve] of finishing.rivers?.reaches ?? []) {
    let run: number[][] = [];
    for (let n = 0; n <= curve.points.length; n++) {
      if (n < curve.points.length && curve.forms?.[n] === Landform.Gorge) {
        run.push([curve.points[n][0] + mesh.origin[0], curve.points[n][1] + mesh.origin[1]]);
        continue;
      }
      if (run.length > 1) publishGorge(state, `${id}:${n}`, run, work.map.RiverWidth[id], dry);
      run = [];
    }
  }
}
function publishGorge(
  state: GenerationState,
  id: string,
  points: number[][],
  width: number,
  dry: ((shape: import("geojson").Geometry) => import("geojson").Geometry | null)[]
) {
  const footprint = spatial.buffer(
    { type: "LineString", coordinates: points },
    Math.max(200, width * 5)
  );
  let clipped = footprint && spatial.intersection(footprint, state.domain.scope.footprint);
  for (const subtract of dry) if (clipped) clipped = subtract(clipped);
  if (clipped)
    putGenerated(
      state,
      generatedFeature(state, `gorge:${id}`, "Gorge", "gorge", "geology", clipped, {
        sourceAlgorithm: "atlas-macro-finishing-1",
      })
    );
}
