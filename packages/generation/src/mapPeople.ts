import { mapCommand, executeMapOperation, processOwner } from "./processTraits";
import { runOperation } from "./processOperation";
import {
  canonicalPosition,
  fieldChartFootprint,
  gridPosition,
  KeyedHeap,
  semanticId,
  spatial,
  MapScale,
  requireChannel,
  type Entity,
  type Position,
} from "@atlas/domain";
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
import { mapScale } from "./worldSignificance";

export function* landCells(state: GenerationState) {
  const covers = spatial.pointCoverage(fieldChartFootprint(state.surface));
  for (let i = 0; i < state.surface.active.length; i++)
    if (dryLand(state, i) && covers(gridPosition(state.surface, i))) yield i;
}
export function suitability(state: GenerationState, i: number) {
  const grid = state.surface,
    scale = mapScale(state),
    elevation = requireChannel(grid, "Elevation");
  const temperature = grid.channels.Temperature?.get(i) ?? 450;
  const rain =
    (grid.channels.Rainfall?.get(i) ?? MapScale.inUnits(scale.length(0.000000125), "mm")) /
    MapScale.inUnits(scale.length(0.00000025), "mm");
  return (
    (Math.exp(-Math.abs(temperature - 460) / 200) * (0.2 + Math.min(1, rain))) /
    (1 +
      Math.max(0, elevation.get(i) - (grid.channels.EffectiveSeaLevel?.get(i) ?? 0)) /
        MapScale.inUnits(scale.length(0.000375, 0.5), "native"))
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
    const position = canonicalPosition(
      state.domain.world.reference,
      gridPosition(state.surface, i)
    );
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
  const candidates = new KeyedHeap("max");
  for (const i of landCells(state))
    candidates.push(i, suitability(state, i) * (0.6 + context.random() * 0.4));
  const selected: number[] = [];
  const separation = mapScale(state).length(1 / (count * 1.5));
  // Scores never change. Visit the ranked candidates once, including when the
  // remaining land cannot fit another origin at the requested separation.
  while (candidates.size && selected.length < count) {
    const i = candidates.pop();
    const position = gridPosition(state.surface, i);
    if (
      selected.some((j) => {
        const p = gridPosition(state.surface, j);
        return Math.hypot(position.x - p.x, position.y - p.y) < separation;
      })
    )
      continue;
    selected.push(i);
  }
  return selected;
}
export const culturalProcess: MapProcess = {
  contract: {
    id: "human.cultures",
    version: "1",
    parameters: {
      cultureCount: { type: "integer", unit: null, required: false, default: 3, minimum: 1 },
    },
    requires: ["Elevation"],
    produces: ["cultures"],
    invalidates: [],
  },
  operation: publishCultures,
  validate: () => [],
};
export const culturalDevelopmentProcess: MapProcess = {
  contract: { ...culturalProcess.contract, id: "human.culture-development" },
  operation: mapCommand(
    "human.culture-development",
    "event",
    (state, context) => {
      if (state.society?.inherited) return;
      const standalone = !state.society;
      executeMapOperation(initializeCultures, state, context);
      bindSocietyProfile(state, context);
      const eras = context.inputs?.features
        ? presentEras(generationBindings(context).settings)
        : [];
      if (standalone)
        for (const era of eras)
          runOperation(processOwner(state), diffuseCultures, {
            state,
            context: {
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
            years: era.years,
          });
    },
    []
  ),
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
    requires: ["Elevation"],
    produces: ["politics"],
    invalidates: [],
  },
  operation: mapCommand(
    "human.politics",
    "publish",
    (state) => {
      if (state.society?.region.politics) publishPolitics(state);
    },
    []
  ),
  validate: () => [],
};
export const politicalDevelopmentProcess: MapProcess = {
  contract: { ...politicalProcess.contract, id: "human.politics-development" },
  operation: mapCommand(
    "human.politics-development",
    "event",
    (state, context) => {
      if (state.society?.inherited) return;
      const standalone = !state.society?.region.politics;
      executeMapOperation(initializePolitics, state, context);
      bindSocietyProfile(state, context);
      if (standalone) {
        const eras = context.inputs?.features
          ? presentEras(generationBindings(context).settings)
          : [];
        for (const era of eras)
          runOperation(processOwner(state), evolvePolitics, {
            state,
            context: {
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
            years: era.years,
          });
      }
    },
    []
  ),
  validate: () => [],
};
