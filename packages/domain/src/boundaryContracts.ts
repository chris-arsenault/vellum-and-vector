import type { Geometry } from "geojson";
import {
  profiles,
  type Area,
  type AtlasFeature,
  type Crossing,
  type FieldSample,
  type Position,
  type World,
} from "./model";
import type { DomainSnapshot } from "./operations";
import { composeFeature, areaSpace } from "./composition";
import { validateCausalLift } from "./causalLift";
import { spatial, point } from "./spatial";
import { sample, type Grid } from "./grids";
import { adaptiveCell } from "./adaptiveTopology";
import { visitAdaptiveOverlap } from "./adaptiveTransfer";
import { crossingDirection, lineParts, stationAt } from "./lineStations";
import { semanticId } from "./identity";
import { requireThat } from "./errors";
import { fieldFact } from "./fieldValidation";

export function sampleFields(snapshot: DomainSnapshot, p: Position): Record<string, number> {
  const result = Object.create(null) as Record<string, number>;
  const fields = Object.entries(snapshot.numerical)
    .filter(([, g]) => spatial.covers(g.scope.footprint, point(p)))
    .sort(([, a], [, b]) => (b.scope.resolution ?? Infinity) - (a.scope.resolution ?? Infinity));
  for (const [field, grid] of fields) {
    const binding = snapshot.world.fields.find((f) => f.id === field),
      layer = binding && snapshot.world.layers[binding.layerId];
    if (!layer) continue;
    for (const channel of Object.keys(grid.channels))
      result[fieldFact(layer, channel)] = sample(grid, channel, p);
  }
  return result;
}
export function boundaryRings(footprint: Geometry): number[][][] {
  if (footprint.type === "Polygon") return footprint.coordinates;
  requireThat(
    footprint.type === "MultiPolygon",
    "area_footprint",
    "A boundary contract needs polygonal rings."
  );
  return footprint.coordinates.flat();
}
function ringSamples(snapshot: DomainSnapshot, ring: number[][], elevation: number): FieldSample[] {
  const samples: FieldSample[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i],
      b = ring[i + 1],
      length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length === 0) continue;
    const divisions = sampleDivisions(Object.values(snapshot.numerical), a, b);
    for (let j = 0; j < divisions; j++) {
      const fraction = j / divisions,
        p = {
          x: a[0] + fraction * (b[0] - a[0]),
          y: a[1] + fraction * (b[1] - a[1]),
          z: elevation,
        };
      const values = sampleFields(snapshot, p);
      samples.push({ point: { ...p, z: values.elevation ?? elevation }, values });
    }
  }
  return samples;
}
function sampleDivisions(fields: Grid[], a: number[], b: number[]): number {
  const segment: Geometry = { type: "LineString", coordinates: [a, b] },
    length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const spacings = fields
    .filter((g) => spatial.intersects(g.scope.footprint, segment))
    .map((g) =>
      g.mesh
        ? g.mesh.spacing
        : g.topology
          ? adaptiveBoundarySpacing(g, segment)
          : Math.min(
              (g.bounds[2] - g.bounds[0]) / (g.width - 1),
              (g.bounds[3] - g.bounds[1]) / (g.height - 1)
            )
    );
  return spacings.length ? Math.max(1, Math.ceil(length / Math.min(...spacings))) : 1;
}
function adaptiveBoundarySpacing(grid: Grid, segment: Geometry) {
  const sizes: number[] = [];
  visitAdaptiveOverlap(grid.topology!, spatial.bounds(segment), (i) => {
    const b = adaptiveCell(grid.topology!, i);
    sizes.push(Math.min(b[2] - b[0], b[3] - b[1]));
  });
  return sizes.reduce((size, value) => Math.min(size, value), Infinity);
}
export function featureStation(
  snapshot: DomainSnapshot,
  feature: AtlasFeature,
  channel: string,
  p: Position
): number | null {
  const details = Object.entries(feature.detail)
    .filter(
      ([, d]) =>
        !d.needsReconciliation &&
        d.state !== "stale" &&
        d.attributes !== null &&
        spatial.distance(d.geometry, point(p)) <=
          2 * (snapshot.world.reference.precision ?? 0.000001)
    )
    .sort(
      ([a], [b]) =>
        profiles.indexOf(snapshot.world.areas[b].profile) -
        profiles.indexOf(snapshot.world.areas[a].profile)
    );
  for (const [, detail] of details) {
    const value = stationAt(detail.geometry, detail.attributes!, channel, p);
    if (value !== null) return value;
  }
  return stationAt(feature.geometry, feature.attributes, channel, p);
}
function crossing(
  snapshot: DomainSnapshot,
  area: Area,
  feature: AtlasFeature,
  geometry: Geometry,
  p: Position,
  index: number
): Crossing {
  const fields = sampleFields(snapshot, p),
    elevation = featureStation(snapshot, feature, "elevations", p) ?? fields.elevation;
  const flow = featureStation(snapshot, feature, "discharges", p) ?? fields.flow;
  return {
    featureId: feature.id,
    point: { ...p, z: elevation ?? area.frame.origin.z },
    kind: feature.kind,
    flow: flow ?? 0,
    elevation: elevation ?? area.frame.origin.z,
    direction:
      feature.kind === "river"
        ? crossingDirection(
            geometry,
            area.footprint,
            p,
            snapshot.world.reference.precision ?? 0.000001
          )
        : "undirected",
    nodeId: semanticId(
      snapshot.world.id,
      "boundary-node",
      JSON.stringify([area.id, feature.id, index])
    ),
    receivingFeatureId: null,
    flowUncertainty: 0,
    flowMinimum: flow ?? null,
    flowMaximum: flow ?? null,
    flowKnown: flow !== undefined,
    elevationKnown: elevation !== undefined,
  };
}
export function establishBoundary(
  snapshot: DomainSnapshot,
  area: Area
): NonNullable<Area["boundary"]> {
  requireThat(
    area.parentId !== null,
    "boundary_parent",
    "A refinement contract needs a geographic parent."
  );
  const parent = snapshot.world.areas[area.parentId];
  requireThat(parent, "missing_parent", "The geographic parent must be available.");
  const crossings: Crossing[] = [];
  for (const feature of Object.values(snapshot.world.features)) {
    if (areaSpace(snapshot.world, feature.areaId) !== areaSpace(snapshot.world, parent.id))
      continue;
    const layer = snapshot.world.layers[feature.layerId];
    if (layer?.representation !== "network") continue;
    const geometry = composeFeature(snapshot.world, feature);
    if (geometry === null) continue;
    if (!geometry.type.includes("LineString")) continue;
    for (const [index, p] of spatial.crossings(geometry, area.footprint).entries())
      crossings.push(crossing(snapshot, area, feature, geometry, p, index));
  }
  const rings = boundaryRings(area.footprint).map((ring) =>
    ringSamples(snapshot, ring, area.frame.origin.z)
  );
  return {
    version: 1,
    parentId: parent.id,
    parentVersion: snapshot.world.version,
    crossings,
    samples: rings.flat(),
    rings,
    epochs: snapshot.world.epochs,
    waterFluxes: [],
    history: snapshot.resources
      .filter((r) => r.kind === "history")
      .map((r) => ({
        epochId: r.scope.time,
        parentEpoch: r.scope.time,
        forcingId: null,
        resources: [r.id, ...r.lineage],
      })),
  };
}
function validateStationContract(
  snapshot: DomainSnapshot,
  feature: AtlasFeature,
  geometry: Geometry,
  attributes: Record<string, unknown>,
  expected: Crossing
) {
  const precision = snapshot.world.reference.precision ?? 0.000001;
  const elevation = contractStation(
    snapshot,
    feature,
    geometry,
    attributes,
    "elevations",
    expected.point
  );
  if (elevation !== null && expected.elevationKnown !== false)
    requireThat(
      Math.abs(elevation - expected.elevation) <= precision,
      "locked_water_level",
      "The edited river must retain its contracted boundary elevation."
    );
  const flow = contractStation(
    snapshot,
    feature,
    geometry,
    attributes,
    "discharges",
    expected.point
  );
  validateFlowContract(flow, expected);
  requireThat(
    feature.kind !== "river" || elevation !== null,
    "river_profile",
    "A river edit needs a resolved elevation profile at its interfaces."
  );
}
function contractStation(
  snapshot: DomainSnapshot,
  feature: AtlasFeature,
  geometry: Geometry,
  attributes: Record<string, unknown>,
  channel: string,
  p: Position
): number | null {
  const values = attributes[channel],
    count = lineParts(geometry).reduce((sum, part) => sum + part.length, 0);
  if (Array.isArray(values) && values.length === count)
    return stationAt(geometry, attributes, channel, p);
  return featureStation(snapshot, feature, channel, p);
}
function validateFlowContract(flow: number | null, expected: Crossing) {
  if (expected.flowKnown === false) return;
  const minimum =
    expected.flowMinimum ?? Math.max(0, expected.flow - (expected.flowUncertainty ?? 0));
  const maximum = expected.flowMaximum ?? expected.flow + (expected.flowUncertainty ?? 0);
  const rounding = 8 * Number.EPSILON * Math.max(1, Math.abs(minimum), Math.abs(maximum));
  requireThat(
    flow !== null && flow >= minimum - rounding && flow <= maximum + rounding,
    "locked_flow",
    "The edited river must retain its contracted discharge envelope."
  );
}
export function validateCrossings(
  snapshot: DomainSnapshot,
  area: Area,
  feature: AtlasFeature,
  geometry: Geometry,
  attributes: Record<string, unknown>
): void {
  if (!area.boundary) return;
  if (snapshot.world.layers[feature.layerId]?.representation !== "network") return;
  const expected = area.boundary.crossings.filter((c) => c.featureId === feature.id),
    actual = spatial.crossings(geometry, area.footprint),
    precision = snapshot.world.reference.precision ?? 0.000001;
  const matches = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y) <= precision;
  requireThat(
    expected.length === actual.length &&
      expected.every((c) => actual.some((p) => matches(c.point, p))),
    "locked_boundary",
    "Keep contracted crossing anchors; use boundary reconciliation to change their locations."
  );
  for (const c of expected) {
    if (feature.kind !== "river") continue;
    requireThat(
      c.direction === undefined ||
        c.direction === "undirected" ||
        crossingDirection(geometry, area.footprint, c.point, precision) === c.direction,
      "locked_direction",
      "A river keeps its contracted inlet and outlet direction."
    );
    validateStationContract(snapshot, feature, geometry, attributes, c);
  }
}
export function validateRiverProfile(
  world: Pick<World, "reference" | "areas">,
  feature: AtlasFeature,
  geometry: Geometry,
  attributes: Record<string, unknown>
): void {
  if (feature.kind !== "river") return;
  const heights = attributes.elevations,
    parts = lineParts(geometry),
    precision = world.reference.precision ?? 0.000001;
  requireThat(
    Array.isArray(heights) &&
      heights.length === parts.reduce((n, p) => n + p.length, 0) &&
      heights.every((v) => typeof v === "number" && Number.isFinite(v)),
    "river_profile",
    "River vertices need a finite elevation profile."
  );
  let offset = 0;
  const ascents: { geometry: Geometry; rise: number }[] = [];
  for (const part of parts) {
    for (let i = 1; i < part.length; i++) {
      const rise = (heights[offset + i] as number) - (heights[offset + i - 1] as number);
      if (rise > precision)
        ascents.push({
          geometry: { type: "LineString", coordinates: [part[i - 1], part[i]] },
          rise,
        });
    }
    offset += part.length;
  }
  validateCausalLift(world, feature.areaId, attributes.liftCause, ascents);
}
