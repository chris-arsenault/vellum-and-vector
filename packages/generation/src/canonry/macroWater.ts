import { spatial, waterIdentity, type WaterBody } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState } from "../process";
import { oceanFootprint, lakeFootprint } from "./geographicContours";
import { addTerrainProfile, profileElevation, finishedElevation } from "./macroTerrain";
import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { nativePosition } from "./atlasWorkspace";
import { clearWaterSurface } from "./field";

type Point = [number, number];
function boundaryEdge(a: number[], b: number[], bounds: number[]) {
  return (
    (a[0] === b[0] && (a[0] === bounds[0] || a[0] === bounds[2])) ||
    (a[1] === b[1] && (a[1] === bounds[1] || a[1] === bounds[3]))
  );
}
function rings(geometry: Geometry): number[][][] {
  if (geometry.type === "Polygon") return geometry.coordinates;
  return geometry.type === "MultiPolygon" ? geometry.coordinates.flat() : [];
}
function shoreArcs(shape: Geometry, bounds: number[]) {
  const result: Point[][] = [];
  for (const ring of rings(shape)) {
    let arc: Point[] = [];
    for (let n = 0; n < ring.length - 1; n++) {
      const a = ring[n],
        b = ring[n + 1],
        boundary = boundaryEdge(a, b, bounds);
      if (boundary) {
        if (arc.length > 1) result.push(arc);
        arc = [];
        continue;
      }
      if (!arc.length) arc.push([a[0], a[1]]);
      arc.push([b[0], b[1]]);
    }
    if (arc.length > 1) result.push(arc);
  }
  return result;
}
function smoothRing(source: number[][], anchors: Point[], bounds: number[]): number[][] {
  let points = source.slice(0, -1);
  for (let pass = 0; pass < 2; pass++) {
    const next: number[][] = [];
    for (let n = 0; n < points.length; n++) {
      const a = points[n],
        b = points[(n + 1) % points.length],
        edge = a[0] === bounds[0] || a[0] === bounds[2] || a[1] === bounds[1] || a[1] === bounds[3],
        anchored = anchors.some(([x, y]) => Math.hypot(a[0] - x, a[1] - y) < 15_000);
      if (edge || anchored || Math.hypot(b[0] - a[0], b[1] - a[1]) < 2000) {
        next.push(a);
        continue;
      }
      next.push(
        [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
        [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]
      );
    }
    points = next;
  }
  return [...points, points[0]];
}
function smoothWater(geometry: Geometry, anchors: Point[], bounds: number[]): Geometry {
  const polygon = (coordinates: number[][][]) =>
    coordinates.map((ring) => smoothRing(ring, anchors, bounds));
  const composed =
    geometry.type === "Polygon"
      ? { type: "Polygon" as const, coordinates: polygon(geometry.coordinates) }
      : geometry.type === "MultiPolygon"
        ? { type: "MultiPolygon" as const, coordinates: geometry.coordinates.map(polygon) }
        : geometry;
  return spatial.buffer(composed, 0) ?? geometry;
}
function mouths(work: AtlasPhysicalWorkspace) {
  const map = work.map,
    mesh = map.mesh,
    result: Point[] = [];
  for (let i = 0; i < mesh.count; i++) {
    const j = map.FlowTargets[i];
    if (j < 0 || map.WaterKindCodes[i] || !map.WaterKindCodes[j] || map.RiverOrders[i] <= 0)
      continue;
    const level = map.WaterSurfaceElevations[j],
      t = Math.max(
        0,
        Math.min(1, (level - map.Elevation[i]) / (map.Elevation[j] - map.Elevation[i]))
      );
    result.push([
      mesh.x[i] + (mesh.x[j] - mesh.x[i]) * t + mesh.origin[0],
      mesh.y[i] + (mesh.y[j] - mesh.y[i]) * t + mesh.origin[1],
    ]);
  }
  return result;
}
function fitBody(
  work: AtlasPhysicalWorkspace,
  id: string,
  old: Geometry,
  shape: Geometry,
  level: number,
  boundary: number[]
) {
  const bounds = spatial.bounds(shape),
    ground = finishedElevation(work),
    center: Point = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
    radius = Math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1]),
    value = profileElevation(work, level),
    shoreWidth = Math.max(200, Math.min(5000, Math.sqrt(spatial.area(shape)) * 0.025));
  addTerrainProfile(work, {
    id: `water-floor:${id}`,
    points: [center],
    widths: [radius],
    values: { elevation: [value - 2] },
    footprint: shape,
    plateau: true,
    operation: "lower",
  });
  addTerrainProfile(work, {
    id: `exposed-shore:${id}`,
    points: [center],
    widths: [radius],
    values: { elevation: [value + 2] },
    footprint: old,
    exclusions: { elevation: [shape] },
    plateau: true,
    operation: "raise",
  });
  for (const [n, ring] of shoreArcs(shape, boundary).entries()) {
    const sections = coastalSections(work, ring, ground, value, shoreWidth),
      dry = spatial.difference(work.finishing!.baseSurface!.scope.footprint, shape);
    if (dry)
      addTerrainProfile(work, {
        id: `coastal-land:${id}:${n}`,
        points: sections.map((s) => s.land),
        widths: sections.map((s) => s.width * 0.8),
        values: { elevation: sections.map((s) => s.landHeight) },
        footprint: dry,
        operation: "replace",
        strength: 0.65,
      });
    addTerrainProfile(work, {
      id: `coastal-slope:${id}:${n}`,
      points: sections.map((s) => s.sea),
      widths: sections.map((s) => s.width),
      values: { elevation: sections.map((s) => Math.min(value - 2, s.seaHeight)) },
      footprint: shape,
      operation: "lower",
      strength: 0.65,
    });
    addTerrainProfile(work, {
      id: `shore:${id}:${n}`,
      points: ring.map(([x, y]) => [x, y]),
      widths: sections.map((s) => s.width),
      values: { elevation: ring.map(() => value) },
      operation: "replace",
    });
  }
}
function coastalSections(
  work: AtlasPhysicalWorkspace,
  ring: Point[],
  ground: (x: number, y: number) => number,
  level: number,
  width: number
) {
  const mesh = work.map.mesh,
    height = (p: Point) =>
      profileElevation(work, ground(p[0] - mesh.origin[0], p[1] - mesh.origin[1]));
  return ring.map((p, n) => {
    const a = ring[Math.max(0, n - 1)],
      b = ring[Math.min(ring.length - 1, n + 1)],
      length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1,
      nx = -(b[1] - a[1]) / length,
      ny = (b[0] - a[0]) / length,
      first: Point = [p[0] + nx * width, p[1] + ny * width],
      second: Point = [p[0] - nx * width, p[1] - ny * width],
      h1 = height(first),
      h2 = height(second),
      land = h1 >= h2 ? first : second,
      sea = h1 >= h2 ? second : first,
      landHeight = Math.max(h1, h2),
      cliff = landHeight - level > 100;
    return {
      land,
      sea,
      landHeight,
      seaHeight: Math.min(h1, h2),
      width: cliff ? width * 0.25 : width,
    };
  });
}
export function composeWaterBodies(state: GenerationState) {
  console.time("Macro shorelines");
  const work = state.physical!,
    map = work.map,
    anchors = mouths(work),
    bounds = state.surface.bounds,
    ocean = oceanFootprint(state);
  if (ocean) {
    const shape = smoothWater(ocean, anchors, bounds);
    work.finishing!.ocean = shape;
    fitBody(work, "ocean", ocean, shape, map.EffectiveSeaLevel, bounds);
  }
  const lakes = new Map<number, number[]>();
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes[i] === 2) {
      const body = map.WaterBodyIds[i],
        cells = lakes.get(body) ?? [];
      cells.push(i);
      lakes.set(body, cells);
    }
  for (const [body, cells] of lakes) {
    const level = map.WaterSurfaceElevations[cells[0]],
      source = lakeFootprint(state, cells, body, level);
    if (!source) continue;
    const shape = smoothWater(source, anchors, bounds);
    work.finishing!.lakes.set(body, { footprint: shape, level });
    fitBody(work, `lake:${body}`, source, shape, level, bounds);
  }
  console.timeEnd("Macro shorelines");
}
export function finalWaterBodies(work: AtlasPhysicalWorkspace): WaterBody[] {
  const map = work.map,
    groups = new Map<number, number[]>();
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes[i] === 2) {
      const body = map.WaterBodyIds[i],
        cells = groups.get(body) ?? [];
      cells.push(i);
      groups.set(body, cells);
    }
  return [...work.finishing!.lakes].map(([id, lake]) => {
    const cells = groups.get(id) ?? [],
      outflow = cells.find((i) => map.LakeOutletTargets[i] >= 0),
      volume = cells.reduce(
        (sum, i) => sum + (map.WaterDepths[i] / 1024) * map.mesh.contentAreas[i],
        0
      ),
      slices = cells.map((i) => ({
        floor: profileElevation(work, map.Elevation[i]),
        area: map.mesh.contentAreas[i],
        footprint: null,
        sediment: (map.SedimentThickness[i] / 1024) * map.mesh.contentAreas[i],
      }));
    return {
      id: String(id),
      footprint: lake.footprint,
      fixedLevel: profileElevation(work, lake.level),
      slices,
      volume,
      spill: profileElevation(work, lake.level),
      outlet: outflow === undefined ? null : nativePosition(work, map.LakeOutletTargets[outflow]),
      outletFrom: outflow === undefined ? null : nativePosition(work, outflow),
      suspended: 0,
      outletPath: null,
    };
  });
}

export function reconcileFinishedWater(work: AtlasPhysicalWorkspace) {
  const map = work.map,
    finishing = work.finishing!;
  if (!finishing.baseSurface) return;
  const grid = {
      ...finishing.baseSurface,
      ocean: finishing.ocean,
      waterBodies: finalWaterBodies(work),
      channels: { seaLevel: new Float64Array([profileElevation(work, map.EffectiveSeaLevel)]) },
    },
    identity = waterIdentity(grid);
  for (let i = 0; i < map.mesh.count; i++) {
    if (i >= map.mesh.contentCount) continue;
    const body = identity(nativePosition(work, i)),
      level = body.kind === 2 ? finishing.lakes.get(body.id)!.level : map.EffectiveSeaLevel;
    const wet = body.kind > 0 && level > map.Elevation[i];
    map.WaterKindCodes[i] = wet ? body.kind : 0;
    map.WaterBodyIds[i] = wet ? body.id : 0;
    if (wet) {
      map.WaterSurfaceElevations[i] = level;
      map.WaterDepths[i] = level - map.Elevation[i];
      map.DrainageElevations[i] = level;
    } else {
      clearWaterSurface(map, i);
      map.LakeOverflow[i] = 0;
      map.LakeOutletTargets[i] = -1;
    }
  }
}
