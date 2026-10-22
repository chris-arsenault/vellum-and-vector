import {
  fieldContour,
  sampledFieldContour,
  spatial,
  geometryParts,
  type Bounds,
  type SampleEnclosure,
  type EncloseSegment,
  preparedValue,
  rectangle,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import type { Geometry, LineString } from "geojson";
import type { PhysicalField } from "./field";
import { ecologicalSupport } from "./ecologicalSupport";
import { triangleFans, triangleBoundary } from "./triangleSampling";
import { physicalFieldReader } from "./continuousState";
import type { ChannelPoint } from "./riverChannelPaths";

export function lakeFootprint(
  state: GenerationState,
  members: number[],
  body: number,
  level: number
) {
  const map = state.physical!.map,
    mesh = map.mesh,
    field = map.continuous!,
    floor = preparedValue(field.support, map.Elevation, {
      coefficients: field.coefficients.Elevation,
      adaptive: field.adaptive.Elevation,
    }),
    wet = (x: number, y: number) => level - floor(x, y),
    seeds = members;
  const enclose = (box: Bounds): SampleEnclosure => {
    const data = floor.enclose(box);
    return {
      range: [level - data.range[1], level - data.range[0]],
      gradient: data.gradient.map(([a, b]) => [-b, -a]) as SampleEnclosure["gradient"],
    };
  };
  const segment: EncloseSegment = (a, b) => {
    const data = floor.segment(a, b);
    return {
      range: [level - data.range[1], level - data.range[0]],
      derivative: [-data.derivative[1], -data.derivative[0]],
    };
  };
  const contour = physicalContour(state, wet, enclose, segment, undefined);
  const bounds = mesh.bounds;
  const footprint =
    contour &&
    spatial.intersection(
      contour,
      rectangle([
        bounds[0] + mesh.origin[0],
        bounds[1] + mesh.origin[1],
        bounds[2] + mesh.origin[0],
        bounds[3] + mesh.origin[1],
      ])
    );
  if (!footprint) return null;
  // Drainage identifies the connected basin. Its shoreline is the terrain's
  // intersection with this body's stage, never an interpolation of body IDs.
  const sections = lakeOutletSections(map, body);
  const candidates = sections.length
    ? spatial.partition(footprint, sections)
    : geometryParts(footprint);
  const parts = candidates.filter((part) => {
    if (part.type !== "Polygon") return false;
    const covers = spatial.pointCoverage(part);
    return seeds.some(
      (i) =>
        map.WaterBodyIds[i] === body &&
        covers({
          x: mesh.x[i] + mesh.origin[0],
          y: mesh.y[i] + mesh.origin[1],
          z: 0,
        })
    );
  });
  return parts.length ? spatial.unionAll(parts) : null;
}

/** Existing hydraulic links delimit the transition between a pool and its outlet. */
function lakeOutletSections(map: PhysicalField, body: number): LineString[] {
  const mesh = map.mesh,
    reach = Math.hypot(mesh.bounds[2] - mesh.bounds[0], mesh.bounds[3] - mesh.bounds[1]);
  const sections: LineString[] = [];
  for (let i = 0; i < mesh.count; i++) {
    const j = map.LakeOutletTargets[i];
    if (j < 0) continue;
    let receiving = j;
    while (receiving >= 0 && map.WaterKindCodes[receiving] === 0)
      receiving = map.DrainageParents[receiving];
    if (map.WaterBodyIds[i] !== body && (receiving < 0 || map.WaterBodyIds[receiving] !== body))
      continue;
    const dx = mesh.x[j] - mesh.x[i],
      dy = mesh.y[j] - mesh.y[i],
      length = Math.hypot(dx, dy);
    if (!length) continue;
    const x = (mesh.x[i] + mesh.x[j]) / 2 + mesh.origin[0],
      y = (mesh.y[i] + mesh.y[j]) / 2 + mesh.origin[1],
      acrossX = (-dy / length) * reach,
      acrossY = (dx / length) * reach;
    sections.push({
      type: "LineString",
      coordinates: [
        [x - acrossX, y - acrossY],
        [x + acrossX, y + acrossY],
      ],
    });
  }
  return sections;
}

/** Trace a predicate over prepared physical fields on the complete connected domain. */
export function physicalContour(
  state: GenerationState,
  at: (x: number, y: number) => number,
  enclose?: (box: Bounds) => SampleEnclosure,
  segment?: EncloseSegment,
  scope?: Geometry,
  roots: ChannelPoint[] = []
) {
  const mesh = state.physical!.map.mesh;
  if (mesh.topology)
    return fieldContour(mesh.topology, at, undefined, 0, 10, enclose, segment, scope, roots);
  if (scope) {
    const support = ecologicalSupport(
      mesh,
      Array.from({ length: mesh.count }, (_, i) => i),
      scope
    );
    return sampledFieldContour(
      support.triangles,
      at,
      0,
      support.boundary,
      10,
      enclose,
      segment,
      roots
    );
  }
  const value = (i: number) => at(mesh.x[i] + mesh.origin[0], mesh.y[i] + mesh.origin[1]);
  return sampledFieldContour(
    triangleFans(
      mesh,
      Array.from({ length: mesh.count }, (_, i) => i),
      value
    ),
    at,
    0,
    triangleBoundary(mesh, value),
    10,
    enclose,
    segment,
    roots
  );
}

export function oceanFootprint(state: GenerationState) {
  const map = state.physical!.map,
    mesh = map.mesh,
    height = physicalFieldReader(map, "Elevation"),
    at = (x: number, y: number) =>
      map.EffectiveSeaLevel - height(x - mesh.origin[0], y - mesh.origin[1]);
  const shape = mesh.topology
    ? fieldContour(mesh.topology, at, undefined, 0)
    : sampledFieldContour(
        triangleFans(
          mesh,
          Array.from({ length: mesh.count }, (_, i) => i),
          (i) => map.EffectiveSeaLevel - map.Elevation[i]
        ),
        at,
        0,
        triangleBoundary(mesh, (i) => map.EffectiveSeaLevel - map.Elevation[i])
      );
  if (!shape) return null;
  const oceanSeeds = Array.from({ length: mesh.count }, (_, i) => i).filter(
    (i) => map.WaterKindCodes[i] === 1
  );
  const connected = geometryParts(shape).filter((part) => {
    if (part.type !== "Polygon") return false;
    const covers = spatial.pointCoverage(part);
    return oceanSeeds.some((i) =>
      covers({ x: mesh.x[i] + mesh.origin[0], y: mesh.y[i] + mesh.origin[1], z: 0 })
    );
  });
  return connected.length
    ? spatial.intersection(spatial.unionAll(connected), state.domain.scope.footprint)
    : null;
}
