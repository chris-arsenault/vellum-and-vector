import { gridPosition, semanticId, spatial, type Entity, type Position } from "@atlas/domain";
import { initializePolitics, evolvePolitics } from "./societyPolitics";
import { publishPolitics } from "./societyPoliticalPublication";
import { dryLand } from "./societySupport";
import type { GenerationState, MapProcess, MapProcessContext } from "./process";
import { generationBindings } from "./generationBindings";
import { presentHumanEras, resolvedHumanEras } from "./societyRound";
import type { GenerationSettings } from "./generationSettings";

/** The present eras with bindings resolved to existing epoch ids. */
const presentEras = (settings: GenerationSettings) =>
  presentHumanEras({ ...settings, humanEras: resolvedHumanEras(settings) });
import { initializeCultures, diffuseCultures } from "./societyCulture";
import { publishCultures } from "./societyCulturePublication";
import { atlasName, geographicNamingCulture } from "./atlasNaming";
import { bindSocietyProfile } from "./societyProfile";
import { PriorityQueue } from "./canonry/priorityQueue";

export function* landCells(state: GenerationState) {
  const covers = spatial.pointCoverage(state.domain.scope.footprint);
  for (let i = 0; i < state.surface.active.length; i++)
    if (dryLand(state, i) && covers(gridPosition(state.surface, i))) yield i;
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
  const selected = selectCenters(state, context, count);
  return selected.map((i, index) => {
    const id = semanticId(state.domain.world.id, kind, `${state.domain.scope.areaId}:${index}`);
    const position = gridPosition(state.surface, i);
    const named = atlasName(state.domain.world, {
      key: id,
      kind: kind === "culture" ? "culture" : "polity",
      position,
      term: "Commonwealth",
    });
    const entity: Entity = {
      id,
      kind,
      name: named.name,
      state: "generated",
      attributes: {
        center: position,
        initialPopulation: 1000,
        namingCulture: geographicNamingCulture(state.domain.world, position).id,
      },
      relations: [],
    };
    state.domain.world.entities[id] = entity;
    return entity;
  });
}
function selectCenters(state: GenerationState, context: MapProcessContext, count: number) {
  const candidates = new PriorityQueue<{ i: number; score: number }>(
    (a, b) => b.score - a.score || a.i - b.i,
    state.numerical,
    ["i", "score"]
  );
  for (const i of landCells(state))
    candidates.push({
      i,
      score: suitability(state, i) * (0.6 + context.random() * 0.4),
    });
  const selected: number[] = [];
  const span = Math.max(
    state.surface.bounds[2] - state.surface.bounds[0],
    state.surface.bounds[3] - state.surface.bounds[1]
  );
  // Scores never change. Visit the ranked candidates once, including when the
  // remaining land cannot fit another origin at the requested separation.
  try {
    while (candidates.count && selected.length < count) {
      const { i } = candidates.pop();
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
    return selected;
  } finally {
    candidates.close();
  }
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
      if (state.society?.inherited) {
        publishCultures(state);
        return;
      }
      const standalone = !state.society;
      initializeCultures(state, context);
      bindSocietyProfile(state, context);
      const eras = context.inputs?.features
        ? presentEras(generationBindings(context).settings)
        : [];
      if (standalone)
        for (const era of eras)
          diffuseCultures(
            state,
            {
              ...context,
              epochs: [
                {
                  id: era.id,
                  duration: era.years,
                  parentEpoch: era.physicalEpoch,
                  variables: { mobility: era.mobility },
                },
              ],
            },
            era.years
          );
      publishCultures(state);
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
      if (state.society?.inherited) {
        if (state.society.region.politics) publishPolitics(state);
        return;
      }
      const standalone = !state.society?.region.politics;
      initializePolitics(state, context);
      bindSocietyProfile(state, context);
      if (standalone) {
        const eras = context.inputs?.features
          ? presentEras(generationBindings(context).settings)
          : [];
        for (const era of eras)
          evolvePolitics(
            state,
            {
              ...context,
              epochs: [
                {
                  id: era.id,
                  duration: era.years,
                  parentEpoch: era.physicalEpoch,
                  variables: { politicalCapacity: era.politicalCapacity },
                },
              ],
            },
            era.years
          );
      }
      publishPolitics(state);
    },
  },
  validate: () => [],
};
