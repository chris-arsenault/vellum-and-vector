import type { GenerationState, MapProcess, MapProcessContext } from "../process";
import { initializeMagic, reservoirStock, systemSeed, type MagicField } from "./magicState";
import { locateMagicSources, magicSourceStrategies, supplyMagicSources } from "./magicSources";
import { propagateMagic, magicPropagationStrategies } from "./magicPropagation";
import {
  magicThermalFeedback,
  magicLivingFeedback,
  magicOceanFeedback,
  magicRockFeedback,
  retainMagicHistory,
  holdIce,
} from "./magicFeedback";
import {
  classifyMagicFeatures,
  coverSystems,
  magicConditionRequirements,
  projectMagic,
} from "./magicFeatures";
import { evaluateConfluences } from "./magicConfluences";
import { stormWrites } from "./magicWeather";
import { saltWrites } from "./magicSalt";
import { hallowedWrites } from "./magicHallowed";
import { veilWrites } from "./magicVeil";
import { magicOnTheColumn } from "../rock/rockMagic";
import { nativeContext } from "./context";
import { exchangeMagicWater } from "./magicGroundwater";
import { recordWildZoneHistory } from "./wildZoneHistory";
import { boundPhysicalEpoch, generationBindings, physicalEpochIndex } from "../generationBindings";
import {
  executeMapOperation,
  mapCommand,
  mapQuery,
  mapWork,
  processOwner,
  type MapInput,
  type MapOperation,
} from "../processTraits";
import { defineCommand, readOperation, runOperation, selectOperation } from "../processOperation";
import { oceanRead, seaFloorZones } from "../processes/climateProcesses";
import { coastalForcing } from "./coastalForcing";
import { type Epoch, type MagicConfluence, type MagicSystem } from "@atlas/domain";

/** Refresh derived ice response from retained charge without adding charge or changing ice mass. */
function refreshIcePersistence(state: GenerationState) {
  const { map, magic } = state.physical!;
  map.IcePersistence.fill(0);
  for (const field of magic!.fields) {
    if (!field.definition.enabled || field.definition.effects.icePersistence <= 0) continue;
    const shelf = reservoirStock(field, "shelf");
    for (let cell = 0; cell < map.mesh.count; cell++)
      holdIce(map, field, cell, field.definition.effects.icePersistence, shelf);
  }
}

function supplyPhase(
  state: GenerationState,
  context: MapProcessContext,
  phase: string,
  seed: number
) {
  const epochs = generationBindings(context).settings.epochs,
    index = physicalEpochIndex(epochs, context.epochs),
    fields = state.physical!.magic!.fields;
  for (const field of fields) {
    if (field.definition.phase === phase) {
      if (boundPhysicalEpoch(context) !== undefined)
        supplyMagicSources(state, field, seed, index, sourceActivity(field, epochs[index]));
    } else if (field.definition.enabled && phase === "climate") lapseToStoredCharge(field);
  }
}
const supplyPhaseOperation = defineCommand(
  "magic.source-supply",
  "event",
  ({ state, context, phase }: MapInput & { phase: string }) =>
    supplyPhase(state, context, phase, generationBindings(context).seed),
  []
);
/** Maintained sources are current dependencies even between their supply phases. */
export const currentPhaseFields = <
  T extends { definition: Pick<MagicSystem, "phase" | "effects"> },
>(
  fields: T[],
  phase: string
) =>
  fields.filter(
    (field) => field.definition.phase === phase || field.definition.effects.warding > 0
  );
function sourceActivity(field: MagicField, epoch: Epoch | undefined) {
  return field.definition.enabled
    ? field.definition.strength * (epoch?.magicActivity?.[field.definition.id] ?? 1)
    : 0;
}
function evaluateField(
  state: GenerationState,
  field: MagicField,
  seed: number,
  index: number,
  epoch: Epoch | undefined
) {
  const definition = field.definition;
  if (!definition.enabled) {
    clearCurrent(field);
    return;
  }
  const localSeed = systemSeed(seed, definition.id);
  const activity = definition.strength * (epoch?.magicActivity?.[definition.id] ?? 1);
  locateMagicSources(state, field, localSeed, index, magicSourceStrategies, activity);
  propagateMagic(state, field, localSeed, activity);
}
function clearCurrent(field: MagicField) {
  field.fresh.fill(0);
  for (const name of [
    "intensity",
    "source",
    "wake",
    "rogue",
    "retained",
    "releasing",
    "radii",
    "wild",
  ] as const)
    field[name].fill(0);
  for (const source of Object.values(field.originSources)) source.fill(0);
  field.located = [];
  field.doors = [];
}
/**
 * Between its own evaluations a system is present only as the charge it stored: the live
 * field of the last epoch went with that epoch's climate, and it re-forms in its own phase.
 */
function lapseToStoredCharge(field: MagicField) {
  field.fresh.fill(0);
  for (let i = 0; i < field.intensity.length; i++)
    field.intensity.set(i, Math.min(1000, Math.round(field.stored.get(i))));
}
function applySharedForcing(state: GenerationState, exposure = 0) {
  magicThermalFeedback(state, exposure);
  magicLivingFeedback(state, exposure > 0);
  magicOceanFeedback(state);
  refreshIcePersistence(state);
}
/**
 * Current material and maintained sources determine placement. Atmospheric and habitat
 * inputs are the preceding feedback state: this read publishes forcing for the next
 * atmospheric read, and must not recursively demand that atmosphere or biome classification.
 * No source supply, material reaction or elapsed history occurs here.
 */
export const evaluateSocietyMagic = mapQuery(
  "magic.current",
  (state, context) => {
    if (!state.physical?.magic) return;
    refreshFields(state, context, state.physical!.magic!.fields);
    applySharedForcing(state);
  },
  []
);
/** Classification asks its current field owner after any intervening material command. */
export const classifyCurrentMagic = mapQuery(
  "atlas.magic-classify",
  (state, context) => classifyMagicFeatures(state, generationBindings(context).seed),
  [evaluateSocietyMagic]
);
export const publishCurrentMagic = mapCommand("atlas.magic-project", "publish", projectMagic, [
  classifyCurrentMagic,
]);
export const initializeMagicWorkspace = defineCommand(
  "magic.initialize",
  "initialize",
  ({
    state,
    enabled,
    systems,
    confluences,
  }: {
    state: GenerationState;
    enabled?: boolean;
    systems?: MagicSystem[];
    confluences?: MagicConfluence[];
  }) => {
    initializeMagic(state, enabled, systems, confluences);
    // Intrinsic current reads belong to this initialized owner, not to optional feature producers.
    selectOperation(processOwner(state), evaluateSocietyMagic);
    selectOperation(processOwner(state), classifyCurrentMagic);
  },
  []
);
/** Current dependency order is shared by epoch, present and society evaluation. */
function refreshFields(state: GenerationState, context: MapProcessContext, fields: MagicField[]) {
  const map = state.physical!.map,
    water = { map, context: nativeContext(state, context, 0) };
  // The current coastline follows ground changes; climate and living cover are preceding inputs.
  readOperation(map, oceanRead.operation, water);
  readOperation(map, seaFloorZones.operation, water);
  const bound = generationBindings(context),
    epochs = bound.settings.epochs,
    index = physicalEpochIndex(epochs, context.epochs);
  // Wards first, ordinary fields next, and strain/pairing after their current meetings.
  for (const field of fields.filter((field) => field.definition.effects.warding > 0))
    evaluateField(state, field, bound.seed, index, epochs[index]);
  magicLivingFeedback(state);
  for (const field of fields.filter(
    (field) => !field.definition.effects.warding && !field.definition.effects.tearing
  ))
    evaluateField(state, field, bound.seed, index, epochs[index]);
  magicLivingFeedback(state);
  coverSystems(state, bound.seed);
  evaluateConfluences(state, bound.seed, false);
  for (const field of fields.filter((field) => field.definition.effects.tearing > 0))
    evaluateField(state, field, bound.seed, index, epochs[index]);
}

/** Shared material response. No source supply, stock aging or completed-history write occurs here. */
export const reactMagicMaterial = defineCommand(
  "magic.material-response",
  "work",
  ({
    state,
    response,
  }: {
    state: GenerationState;
    response: { seed: number; phase: number; span: number };
  }) => {
    if (!(response.span > 0)) return;
    magicThermalFeedback(state, response.span);
    evaluateConfluences(state, response.seed, true, response.span);
    stormWrites(state);
    saltWrites(state);
    hallowedWrites(state);
    veilWrites(state, response.phase);
    magicOnTheColumn(state, response.seed, response.span);
  },
  []
);
export function magicProcesses(
  systems: MagicSystem[] = [],
  confluences: MagicConfluence[] = []
): MapProcess[] {
  void confluences;
  const climate = phaseReading("climate");
  const postGlacial = phaseReading("post-glacial");
  const classify = classifyCurrentMagic;
  const actions: Record<string, MapOperation> = {
    initialize: mapCommand(
      "atlas.magic-initialize",
      "initialize",
      (state, context) => {
        const bound = generationBindings(context);
        runOperation(processOwner(state), initializeMagicWorkspace, {
          state,
          enabled:
            bound.features.selection["magic.configured"]?.enabled ??
            bound.domains.includes("magic"),
          systems: bound.settings.magicSystems,
          confluences: bound.settings.confluences,
        });
      },
      []
    ),
    climate: phaseOperation("climate", climate),
    rocks: mapWork(
      "atlas.magic-rocks",
      epochExposure,
      (state, _context, exposure) => {
        if (exposure > 0) magicRockFeedback(state);
      },
      []
    ),
    "post-glacial": phaseOperation("post-glacial", postGlacial),
    coast: mapQuery(
      "atlas.magic-coast",
      (state, context) => {
        executeMapOperation(evaluateSocietyMagic, state, context);
        readOperation(state.physical!.map, coastalForcing, {
          map: state.physical!.map,
          context: nativeContext(state, context, 0),
        });
      },
      []
    ),
    history: mapCommand(
      "atlas.magic-history",
      "event",
      (state, context) => {
        if (boundPhysicalEpoch(context) === undefined) return;
        executeMapOperation(classify, state, context);
        recordWildZoneHistory(state, context);
        retainMagicHistory(state, context);
      },
      []
    ),
    classify,
    project: publishCurrentMagic,
  };
  return Object.entries(actions).map(([id, operation]) => ({
    contract: {
      id: `atlas.magic-${id}`,
      version: "1",
      parameters: {},
      requires: magicRequirements(id, systems),
      produces: [`atlas:magic-${id}`],
      invalidates: [],
      workspaceOnly: id !== "project",
    },
    operation,
    validate: () => [],
  }));
}
const epochExposure = (state: GenerationState, context: MapProcessContext) =>
  boundPhysicalEpoch(context) === undefined ? 0 : nativeContext(state, context, 0).Span;
const phaseReading = (phase: string) =>
  mapQuery(
    `magic.current-${phase}`,
    (state, context) => {
      refreshFields(state, context, currentPhaseFields(state.physical!.magic!.fields, phase));
      applySharedForcing(state);
    },
    []
  );
function phaseOperation(phase: string, current: ReturnType<typeof phaseReading>) {
  return mapWork(
    `atlas.magic-${phase}`,
    epochExposure,
    (state, context, exposure) => {
      const seed = generationBindings(context).seed;
      if (exposure > 0) {
        if (phase === "post-glacial") runOperation(processOwner(state), exchangeMagicWater, state);
        runOperation(processOwner(state), supplyPhaseOperation, { state, context, phase });
      }
      executeMapOperation(current, state, context);
      if (phase !== "post-glacial") {
        if (exposure > 0) applySharedForcing(state, exposure);
        return;
      }
      if (exposure > 0) magicLivingFeedback(state, true);
      coverSystems(state, seed);
      if (exposure > 0)
        runOperation(processOwner(state), reactMagicMaterial, {
          state,
          response: { seed, phase: nativeContext(state, context, 0).EpochIndex, span: exposure },
        });
    },
    []
  );
}

function magicRequirements(id: string, systems: MagicSystem[]) {
  if (id === "initialize") return ["atlas:workspace"];
  const required = ["atlas:workspace", "atlas:magic-initialize"];
  // Either evaluation re-applies every system's heat and melt, so both edit the climate
  // when a system carries those effects; a system that only moves water does not.
  if (
    ["climate", "post-glacial"].includes(id) &&
    systems.some((system) => system.enabled && (system.effects.heat || system.effects.iceMelt))
  )
    required.push("field:Temperature");
  if (id === "rocks") required.push("atlas:magic-climate");
  if (id === "coast") required.push("atlas:magic-post-glacial");
  if (id === "project") required.push("atlas:magic-classify");
  return [...new Set([...required, ...environmentalRequirements(id, systems)])];
}
function environmentalRequirements(id: string, systems: MagicSystem[]) {
  const selected = systems.filter((system) => system.enabled);
  if (["climate", "post-glacial"].includes(id)) {
    const required = selected.filter((system) => system.phase === id).flatMap(systemRequirements);
    // Moving water needs the ocean's geometry; the next circulation pass reads the forcing.
    if (selected.some((system) => system.effects.upwelling || system.effects.seaSurface))
      required.push("field:WaterKindCodes");
    return required;
  }
  if (id === "coast" && selected.some((system) => system.effects.coastalForcing !== 0))
    return ["field:WaterKindCodes", "field:OceanCurrentX"];
  return id === "classify" ? systems.flatMap(magicConditionRequirements) : [];
}
function systemRequirements(system: MagicSystem) {
  return system.origins.flatMap((origin) => [
    ...magicSourceStrategies[origin.source].requires,
    ...magicPropagationStrategies[origin.propagation].requires,
  ]);
}
