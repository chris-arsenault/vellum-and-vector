import {
  createAdaptiveTopology,
  createAdaptiveField,
  gridPosition,
  fieldInterpolator,
  putChannel,
  waterIdentity,
  sampledDetailReader,
  spatial,
  type Grid,
  type GridSurface,
  type Position,
  type SampledDetail,
} from "@atlas/domain";
import { fitLandscapeHeights } from "./macroFit";
import { shoreElementWriter } from "./macroShoreElements";
import {
  landscapeInterpolator,
  landscapeStationSampler,
  type LandscapeProfile,
} from "./landscapeProfiles";

/** Materialize final values; construction profiles never enter the returned field. */
export function sampleFinishedLandscape(
  base: Grid,
  profiles: LandscapeProfile[],
  metadata = base,
  protectedAt: (p: Position) => boolean = () => false
) {
  const started = performance.now(),
    resolution = fieldSpacing(base),
    narrow = profiles.filter((p) => !p.plateau && Math.min(...p.widths) < resolution / 4),
    broad = profiles.filter((p) => !narrow.includes(p)),
    original = fieldInterpolator(base, "elevation"),
    height = landscapeInterpolator(broad, "elevation", original),
    topology = createAdaptiveTopology(base.bounds, {
      maximumSize: resolution,
      minimumSize: resolution / 16,
      refine: (box) => needsSamples(box, height),
    }),
    field = createAdaptiveField(`${base.id}:finished`, base.scope, topology),
    count = field.active.length,
    before = new Float64Array(count),
    target = new Float64Array(count),
    confidence = new Float64Array(count),
    fixed = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const p = gridPosition(field, i);
    before[i] = original(p);
    target[i] = height(p) - before[i];
    confidence[i] = Math.abs(target[i]) > 0.01 ? 1 : 0;
    fixed[i] = Number(!field.active[i] || protectedAt(p));
    if (fixed[i]) target[i] = 0;
  }
  const fit = fitLandscapeHeights(topology, target, confidence, fixed, resolution / 2);
  putChannel(
    field,
    "elevation",
    "metre",
    Float64Array.from(before, (v, i) => v + fit.values[i])
  );
  console.log("Terrain support and fit", (performance.now() - started) / 1000);
  sampleOtherChannels(field, base, metadata, profiles);
  console.log("Terrain channels sampled", (performance.now() - started) / 1000);
  field.detail = sampleStrips(field, base, metadata, narrow, profiles);
  console.log("Terrain detail sampled", (performance.now() - started) / 1000);
  reconcileSampledWater(field, metadata);
  console.log("Finished terrain", {
    samples: count,
    detailElements: (field.detail?.elements.length ?? 0) / 4,
    fitIterations: fit.iterations,
    seconds: (performance.now() - started) / 1000,
  });
  return field;
}
function fieldSpacing(base: Grid) {
  if (!base.topology)
    return Math.max(
      (base.bounds[2] - base.bounds[0]) / (base.width - 1),
      (base.bounds[3] - base.bounds[1]) / (base.height - 1)
    );
  const topology = base.topology;
  return topology.leaves.reduce(
    (maximum, node) =>
      Math.max(
        maximum,
        topology.boxes[node * 4 + 2] - topology.boxes[node * 4],
        topology.boxes[node * 4 + 3] - topology.boxes[node * 4 + 1]
      ),
    0
  );
}
export function reconcileSampledWater(field: GridSurface, metadata: Grid) {
  if (!metadata.channels.water) return;
  field.ocean = metadata.ocean;
  field.waterBodies = metadata.waterBodies;
  const identity = waterIdentity(metadata),
    authored = [...(field.overlays ?? [])].reverse().filter((overlay) => overlay.channels.includes("elevation"))
      .map((overlay) => ({covered: spatial.pointCoverage(overlay.grid.scope.footprint), at: fieldInterpolator(overlay.grid, "elevation")})),
    actual = (p: Position, sampled: number) => {
      const overlay = authored.find((candidate) => candidate.covered(p));
      return overlay ? overlay.at(p) : sampled;
    },
    detailHeight = field.detail ? sampledDetailReader(field.detail, "elevation") : () => null,
    names = ["water", "waterBody", "waterLevel", "waterDepth", "seaLevel"],
    read = (p: Position, elevation: number) => {
      const body = identity(p),
        depth = Math.max(0, body.level - elevation),
        wet = body.kind > 0 && depth > 0;
      return [
        wet ? body.kind : 0,
        wet ? body.id : 0,
        body.level,
        wet ? depth : 0,
        metadata.channels.seaLevel?.[0] ?? 0,
      ];
    },
    values = names.map(() => new Float64Array(field.active.length));
  for (let i = 0; i < field.active.length; i++) {
    const p = gridPosition(field, i),
      sampled = read(p, actual(p, detailHeight(p) ?? field.channels.elevation[i]));
    sampled.forEach((v, j) => (values[j][i] = v));
  }
  names.forEach((name, j) => putChannel(field, name, j < 2 ? "category" : "metre", values[j]));
  const detail = field.detail;
  if (!detail) return;
  const fine = names.map(() => new Float64Array(detail.positions.length / 2));
  for (let i = 0; i < fine[0].length; i++) {
    const p = { x: detail.positions[i * 2], y: detail.positions[i * 2 + 1], z: 0 },
      sampled = read(p, actual(p, detail.channels.elevation[i]));
    sampled.forEach((v, j) => (fine[j][i] = v));
  }
  names.forEach((name, j) => (detail.channels[name] = fine[j]));
}
function needsSamples(box: number[], height: (p: Position) => number) {
  const [x0, y0, x1, y1] = box,
    x = (x0 + x1) / 2,
    y = (y0 + y1) / 2,
    at = (x: number, y: number) => height({ x, y, z: 0 }),
    corners = [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)],
    center = at(x, y),
    error = Math.max(
      Math.abs(center - corners.reduce((a, b) => a + b, 0) / 4),
      Math.abs(at(x, y0) - (corners[0] + corners[1]) / 2),
      Math.abs(at(x, y1) - (corners[2] + corners[3]) / 2),
      Math.abs(at(x0, y) - (corners[0] + corners[3]) / 2),
      Math.abs(at(x1, y) - (corners[1] + corners[2]) / 2)
    );
  return error > 10 || Math.max(...corners, center) - Math.min(...corners, center) > 250;
}
function sampleOtherChannels(
  field: Grid,
  base: Grid,
  metadata: Grid,
  profiles: LandscapeProfile[]
) {
  const names = new Set(["bedrock", "slope", ...profiles.flatMap((p) => Object.keys(p.values))]);
  names.delete("elevation");
  const original = fieldInterpolator(base, "elevation");
  for (const name of names) {
    if (!metadata.channels[name]) continue;
    if (name === "slope") {
      putChannel(field, name, metadata.units[name], terrainSlopes(field));
      continue;
    }
    const source = fieldInterpolator(
      name === "bedrock" && base.channels.bedrock ? base : metadata,
      name
    );
    if (name === "bedrock") {
      putChannel(
        field,
        name,
        metadata.units[name],
        Float64Array.from(field.channels.elevation, (height, i) => {
          const p = gridPosition(field, i);
          return source(p) + height - original(p);
        })
      );
      continue;
    }
    const read = landscapeInterpolator(profiles, name, source, metadata.units[name] === "category");
    putChannel(
      field,
      name,
      metadata.units[name],
      Float64Array.from(field.active, (_, i) => read(gridPosition(field, i))),
      metadata.quantities?.[name]
    );
  }
}
function terrainSlopes(field: Grid) {
  const topology = field.topology!;
  return Float64Array.from(field.active, (_, i) => {
    let xx = 0,
      xy = 0,
      yy = 0,
      xh = 0,
      yh = 0;
    for (let edge = topology.offsets[i]; edge < topology.offsets[i + 1]; edge++) {
      const j = topology.neighbors[edge],
        dx = topology.directionX[edge],
        dy = topology.directionY[edge],
        slope =
          (field.channels.elevation[j] - field.channels.elevation[i]) / topology.distances[edge],
        weight = topology.faceLengths[edge] / topology.distances[edge];
      xx += dx * dx * weight;
      xy += dx * dy * weight;
      yy += dy * dy * weight;
      xh += dx * slope * weight;
      yh += dy * slope * weight;
    }
    const determinant = xx * yy - xy * xy;
    return determinant > 0
      ? Math.hypot((xh * yy - yh * xy) / determinant, (yh * xx - xh * xy) / determinant)
      : 0;
  });
}
function stripPoints(profile: LandscapeProfile, station: number) {
  const point = profile.points[station],
    a = profile.points[Math.max(0, station - 1)],
    b = profile.points[Math.min(profile.points.length - 1, station + 1)],
    length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1,
    width = profile.widths[station];
  return [-1, -0.5, 0, 0.5, 1].map((t): Position => ({
    x: point[0] - ((b[1] - a[1]) / length) * width * t,
    y: point[1] + ((b[0] - a[0]) / length) * width * t,
    z: 0,
  }));
}
function sampleStrips(
  field: Grid,
  base: Grid,
  metadata: Grid,
  narrow: LandscapeProfile[],
  profiles: LandscapeProfile[]
): SampledDetail | undefined {
  if (!narrow.length) return;
  const positions: number[] = [],
    elements: number[] = [],
    values: Record<string, number[]> = {},
    original = fieldInterpolator(base, "elevation"),
    readers = stripReaders(metadata, narrow, original),
    rock = base.channels.bedrock ? fieldInterpolator(base, "bedrock") : original,
    coarse = fieldInterpolator(field, "elevation"),
    station = landscapeStationSampler(
      profiles,
      readers,
      new Set(narrow),
      new Set(Object.keys(readers).filter((name) => metadata.units[name] === "category"))
    );
  for (const name of Object.keys(readers)) values[name] = [];
  values.bedrock = [];
  const sample = (p: Position) => {
      const at = station(p),
        sampled = at.values;
      if (at.coverage < 1 - 1e-9)
        sampled.elevation += (coarse(p) - at.broadHeight) * (1 - at.coverage);
      sampled.bedrock = rock(p) + sampled.elevation - original(p);
      return sampled;
    },
    vertex = (p: Position) => appendVertex(p, sample, positions, values),
    element = shoreElementWriter(positions, values, elements, waterIdentity(metadata),
      new Set(Object.keys(readers).filter((name) => metadata.units[name] === "category")));
  for (const profile of narrow) {
    if (profile.points.length === 1) {
      appendSpot(profile, vertex, element);
      continue;
    }
    const stations = profile.points.map((_, n) => stripPoints(profile, n).map(vertex));
    for (let n = 1; n < profile.points.length; n++) {
      const a = stations[n - 1],
        b = stations[n];
      for (let band = 0; band < 4; band++)
        element([a[band], b[band], b[band + 1], a[band + 1]]);
    }
  }
  return {
    positions: Float64Array.from(positions),
    elements: Uint32Array.from(elements),
    channels: Object.fromEntries(
      Object.entries(values).map(([name, data]) => [name, Float64Array.from(data)])
    ),
  };
}
function appendVertex(
  p: Position,
  sample: (p: Position) => Record<string, number>,
  positions: number[],
  values: Record<string, number[]>
) {
  const index = positions.length / 2,
    sampled = sample(p);
  positions.push(p.x, p.y);
  for (const [name, value] of Object.entries(sampled)) values[name].push(value);
  return index;
}
function appendSpot(
  profile: LandscapeProfile,
  vertex: (p: Position) => number,
  element: (vertices: number[]) => void
) {
  const [x, y] = profile.points[0],
    radius = profile.widths[0],
    rows = Array.from({ length: 5 }, (_, row) =>
      Array.from({ length: 5 }, (_, col) =>
        vertex({ x: x + (col / 2 - 1) * radius, y: y + (row / 2 - 1) * radius, z: 0 })
      )
    );
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 4; col++)
      element([rows[row][col], rows[row][col + 1], rows[row + 1][col + 1], rows[row + 1][col]]);
}
function stripReaders(metadata: Grid, narrow: LandscapeProfile[], height: (p: Position) => number) {
  const readers: Record<string, (p: Position) => number> = { elevation: height };
  for (const name of new Set(narrow.flatMap((p) => Object.keys(p.values)))) {
    if (readers[name] || !metadata.channels[name]) continue;
    readers[name] = fieldInterpolator(metadata, name);
  }
  return readers;
}
