import {
  gridPosition,
  putChannel,
  semanticId,
  spatial,
  type Entity,
  type Position,
} from "@atlas/domain";
import { generatedFeature, putGenerated, cellPolygon } from "./mapFeatures";
import type { GenerationState, MapProcess, MapProcessContext } from "./process";

export function landCells(state: GenerationState) {
  return Array.from(state.surface.active.keys()).filter(
    (i) => state.surface.active[i] && state.surface.channels.elevation?.[i] > 0
  );
}
export function suitability(state: GenerationState, i: number) {
  const grid = state.surface;
  const temperature = grid.channels.temperature?.[i] ?? 15;
  const rain = grid.channels.rainfall?.[i] ?? 0.5;
  return (
    (Math.exp(-Math.abs(temperature - 16) / 20) * (0.2 + Math.min(1, rain))) /
    (1 + Math.max(0, grid.channels.elevation[i]) / 1500)
  );
}
export function centers(
  state: GenerationState,
  context: MapProcessContext,
  kind: string,
  count: number
): Entity[] {
  const existing = Object.values(state.domain.world.entities).filter(
    (e) =>
      e.kind === kind &&
      e.attributes.center &&
      spatial.covers(state.domain.scope.footprint, {
        type: "Point",
        coordinates: [(e.attributes.center as Position).x, (e.attributes.center as Position).y],
      })
  );
  if (existing.length) return existing;
  const candidates = landCells(state).map((i) => ({
    i,
    score: suitability(state, i) * (0.6 + context.random() * 0.4),
  }));
  const selected: number[] = [];
  const span = Math.max(
    state.surface.bounds[2] - state.surface.bounds[0],
    state.surface.bounds[3] - state.surface.bounds[1]
  );
  while (selected.length < count && candidates.length) {
    candidates.sort((a, b) => b.score - a.score);
    const { i } = candidates.shift()!;
    const position = gridPosition(state.surface, i);
    if (
      selected.some((j) => {
        const p = gridPosition(state.surface, j);
        return Math.hypot(position.x - p.x, position.y - p.y) < span / (count * 1.5);
      })
    )
      continue;
    selected.push(i);
  }
  return selected.map((i, index) => {
    const id = semanticId(state.domain.world.id, kind, `${state.domain.scope.areaId}:${index}`);
    const entity: Entity = {
      id,
      kind,
      name: `${kind === "culture" ? "Culture" : "Polity"} ${index + 1}`,
      state: "generated",
      attributes: { center: gridPosition(state.surface, i), initialPopulation: 1000 },
      relations: [],
    };
    state.domain.world.entities[id] = entity;
    return entity;
  });
}
export const culturalProcess: MapProcess = {
  contract: {
    id: "human.cultures",
    version: "1",
    parameters: {
      cultureCount: { type: "integer", unit: null, required: false, default: 3, minimum: 1 },
    },
    requires: ["elevation"],
    produces: ["cultures"],
    invalidates: [],
  },
  apply(state, context) {
    const origins = centers(state, context, "culture", Number(context.parameters.cultureCount)),
      grid = state.surface;
    const eras = state.domain.world.humanEras ?? [];
    const span = Math.max(grid.bounds[2] - grid.bounds[0], grid.bounds[3] - grid.bounds[1]);
    const elapsed = eras.reduce((sum, era) => sum + era.years * era.mobility, 0);
    const spread = span * (0.15 + Math.sqrt(elapsed / 200) * 0.15);
    for (const origin of origins) {
      const center = origin.attributes.center as Position;
      const values = Float64Array.from(grid.active, (active, i) => {
        if (!active || grid.channels.elevation[i] <= 0) return 0;
        const p = gridPosition(grid, i);
        const distance = Math.hypot(p.x - center.x, p.y - center.y);
        return Math.exp(-(distance * distance) / (2 * spread * spread)) * suitability(state, i);
      });
      putChannel(grid, `culture:${origin.id}`, "ratio", values);
      const marker = generatedFeature(
        state,
        `culture-origin:${origin.id}`,
        `${origin.name} origin`,
        "culturalOrigin",
        "cultures",
        { type: "Point", coordinates: [center.x, center.y] }
      );
      marker.relations = [{ targetId: origin.id, kind: "originOf" }];
      putGenerated(state, marker);
    }
    context.recordCause({
      kind: "domain",
      process: "human.cultures",
      subjects: origins.map((o) => o.id),
      description: `${eras.map((e) => e.id).join(", ") || "Present settlement"}: cultural distributions spread from located origins through suitable terrain. Prevalence can overlap.`,
    });
  },
  validate() {
    return [];
  },
};

export const politicalProcess: MapProcess = {
  contract: {
    id: "human.politics",
    version: "1",
    parameters: {
      polityCount: { type: "integer", unit: null, required: false, default: 3, minimum: 1 },
    },
    requires: ["elevation"],
    produces: ["politics"],
    invalidates: [],
  },
  apply(state, context) {
    const polities = centers(state, context, "polity", Number(context.parameters.polityCount)),
      grid = state.surface;
    const owner = new Int32Array(grid.active.length).fill(-1);
    for (const i of landCells(state)) {
      const p = gridPosition(grid, i);
      const scores = polities.map((entity) => {
        const center = entity.attributes.center as Position;
        return Math.hypot(p.x - center.x, p.y - center.y) * (1.3 - suitability(state, i) * 0.3);
      });
      if (scores.length) owner[i] = scores.indexOf(Math.min(...scores));
    }
    for (const [index, polity] of polities.entries()) territory(state, owner, index, polity);
    context.recordCause({
      kind: "domain",
      process: "human.politics",
      subjects: polities.map((p) => p.id),
      description:
        "Located polities establish sovereign territories from geographic reach. Claims extend beyond control; political identity remains independent of cultural prevalence.",
    });
  },
  validate() {
    return [];
  },
};
function territory(state: GenerationState, owner: Int32Array, index: number, polity: Entity) {
  const grid = state.surface;
  const polygons: number[][][][] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (owner[y * grid.width + x] !== index) continue;
      const start = x;
      while (x + 1 < grid.width && owner[y * grid.width + x + 1] === index) x++;
      polygons.push(cellPolygon(grid, start, x, y).coordinates);
    }
  }
  if (!polygons.length) return;
  // Union contiguous row strips before publishing OGC polygons; shared edges
  // in a raw MultiPolygon would otherwise be topologically invalid.
  let shape = { type: "Polygon" as const, coordinates: polygons[0] } as import("geojson").Geometry;
  for (const coordinates of polygons.slice(1))
    shape = spatial.union(shape, { type: "Polygon", coordinates });
  shape = spatial.intersection(shape, grid.scope.footprint)!;
  const feature = generatedFeature(
    state,
    `sovereignty:${polity.id}`,
    polity.name,
    "sovereignty",
    "sovereignty",
    shape
  );
  feature.relations = [{ targetId: polity.id, kind: "sovereign" }];
  putGenerated(state, feature);
  const control = generatedFeature(
    state,
    `control:${polity.id}`,
    `${polity.name} control`,
    "control",
    "control",
    shape
  );
  control.relations = [{ targetId: polity.id, kind: "controlledBy" }];
  putGenerated(state, control);
  const buffer = Math.min(grid.bounds[2] - grid.bounds[0], grid.bounds[3] - grid.bounds[1]) * 0.025;
  const claim = generatedFeature(
    state,
    `claim:${polity.id}`,
    `${polity.name} claim`,
    "claim",
    "claims",
    spatial.intersection(spatial.buffer(shape, buffer)!, grid.scope.footprint)!
  );
  claim.relations = [{ targetId: polity.id, kind: "claimedBy" }];
  putGenerated(state, claim);
}
