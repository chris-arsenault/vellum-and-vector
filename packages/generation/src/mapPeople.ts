import {
  gridPosition,
  replaceChannel,
  semanticId,
  spatial,
  fieldContour,
  fieldInterpolator,
  type Entity,
  type Position,
} from "@atlas/domain";
import { generatedFeature, putGenerated } from "./mapFeatures";
import type { GenerationState, MapProcess, MapProcessContext } from "./process";
import { generationBindings } from "./generationBindings";

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
  const candidates = landCells(state)
    .map((i) => ({
      i,
      score: suitability(state, i) * (0.6 + context.random() * 0.4),
    }))
    .sort((a, b) => b.score - a.score);
  const selected: number[] = [];
  const span = Math.max(
    state.surface.bounds[2] - state.surface.bounds[0],
    state.surface.bounds[3] - state.surface.bounds[1]
  );
  // Scores never change. Visit the ranked candidates once, including when the
  // remaining land cannot fit another origin at the requested separation.
  for (const { i } of candidates) {
    if (selected.length === count) break;
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
  behavior: {
    kind: "extract",
    extract(state, context) {
      context.progress(0, "Choosing cultural origins");
      const origins = centers(state, context, "culture", Number(context.parameters.cultureCount)),
        grid = state.surface;
      const eras = context.inputs?.features ? generationBindings(context).settings.humanEras : [];
      const span = Math.max(grid.bounds[2] - grid.bounds[0], grid.bounds[3] - grid.bounds[1]);
      const elapsed = eras.reduce((sum, era) => sum + era.years * era.mobility, 0);
      const spread = span * (0.15 + Math.sqrt(elapsed / 200) * 0.15);
      for (const origin of origins) {
        context.progress(
          (origins.indexOf(origin) / origins.length) * 0.9,
          `Spreading ${origin.name}`
        );
        const center = origin.attributes.center as Position;
        const values = Float64Array.from(grid.active, (active, i) => {
          if (!active || grid.channels.elevation[i] <= 0) return 0;
          const p = gridPosition(grid, i);
          const distance = Math.hypot(p.x - center.x, p.y - center.y);
          return Math.exp(-(distance * distance) / (2 * spread * spread)) * suitability(state, i);
        });
        replaceChannel(grid, `culture:${origin.id}`, "ratio", values);
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
  behavior: {
    kind: "extract",
    extract(state, context) {
      context.progress(0, "Choosing polity locations");
      const polities = centers(state, context, "polity", Number(context.parameters.polityCount)),
        grid = state.surface;
      const owner = new Int32Array(grid.active.length).fill(-1);
      context.progress(0.1, `Assigning territory to ${polities.length} polities`);
      for (const i of landCells(state)) {
        const p = gridPosition(grid, i);
        const scores = polities.map((entity) => {
          const center = entity.attributes.center as Position;
          return Math.hypot(p.x - center.x, p.y - center.y) * (1.3 - suitability(state, i) * 0.3);
        });
        if (scores.length) owner[i] = scores.indexOf(Math.min(...scores));
      }
      const heightAt = fieldInterpolator(grid, "elevation");
      for (const [index, polity] of polities.entries()) {
        context.progress(
          0.3 + (0.65 * index) / polities.length,
          `Building territory and claims for ${polity.name} (${index + 1}/${polities.length})`
        );
        territory(state, owner, index, polity, polities, heightAt);
      }
      context.recordCause({
        kind: "domain",
        process: "human.politics",
        subjects: polities.map((p) => p.id),
        description:
          "Located polities establish sovereign territories from geographic reach. Claims extend beyond control; political identity remains independent of cultural prevalence.",
      });
    },
  },
  validate() {
    return [];
  },
};
function territory(
  state: GenerationState,
  owner: Int32Array,
  index: number,
  polity: Entity,
  polities: Entity[],
  heightAt: (position: Position) => number
) {
  const grid = state.surface;
  const topology = grid.topology ?? grid;
  const center = polity.attributes.center as Position;
  const other = polities
    .filter((p) => p.id !== polity.id)
    .map((p) => p.attributes.center as Position);
  const valueAt = (x: number, y: number) => {
    const distance = Math.hypot(x - center.x, y - center.y);
    const reach = other.reduce(
      (limit, p) => Math.min(limit, Math.hypot(x - p.x, y - p.y) - distance),
      Infinity
    );
    return Math.min(heightAt({ x, y, z: 0 }), reach);
  };
  const cells = Array.from(owner.keys()).filter((i) => owner[i] === index);
  if (!cells.length) return;
  // Voronoi reach and height remain defined throughout the numerical halo.
  // A stencil around owned world cells can cut an otherwise open contour;
  // trace the complete field, then clip the closed geometry to the world.
  const contour = fieldContour(topology, valueAt, undefined, 0);
  const shape = contour && spatial.intersection(contour, grid.scope.footprint);
  if (!shape) return;
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
