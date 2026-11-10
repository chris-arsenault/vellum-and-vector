import type { GenerationState, MapProcess, MapProcessContext } from "../process";
import { initializeMagic, systemSeed, type MagicField } from "./magicState";
import {
  locateMagicSources,
  magicSourceStrategies,
  supplyMagicSources,
  supplySocietyEvents,
} from "./magicSources";
import { propagateMagic, magicPropagationStrategies } from "./magicPropagation";
import {
  magicThermalFeedback,
  magicLivingFeedback,
  magicOceanFeedback,
  magicRockFeedback,
  magicCoastalFeedback,
  retainMagicHistory,
} from "./magicFeedback";
import {
  classifyMagicFeatures,
  coverSystems,
  effectiveMagicRules,
  projectMagic,
} from "./magicFeatures";
import { evaluateConfluences } from "./magicConfluences";
import { stormWrites } from "./magicWeather";
import { saltWrites } from "./magicSalt";
import { hallowedWrites } from "./magicHallowed";
import { veilWrites } from "./magicVeil";
import { hallowedOnTheColumn, magicOnTheColumn } from "../rock/rockMagic";
import { nativeContext } from "./context";
import { exchangeMagicWater } from "./magicGroundwater";
import { recordWildZoneHistory } from "./wildZoneHistory";
import { generationBindings, physicalEpochIndex } from "../generationBindings";
import type { ProcessBehavior } from "../processTraits";
import { ecologyLabels, type Epoch, type MagicConfluence, type MagicSystem } from "@atlas/domain";

function evaluateMagic(
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
      if (context.epochIndices[0] !== undefined)
        supplyMagicSources(state, field, seed, index, sourceActivity(field, epochs[index]));
    } else if (field.definition.enabled && phase === "climate") lapseToStoredCharge(field);
  }
  refreshFields(state, context, currentPhaseFields(fields, phase));
}
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
    if (field.doors.length && state.society) state.society.connectionsDirty = true;
    clearCurrent(field);
    return;
  }
  const localSeed = systemSeed(seed, definition.id);
  const activity = definition.strength * (epoch?.magicActivity?.[definition.id] ?? 1);
  const doors = field.doors;
  locateMagicSources(state, field, localSeed, index, magicSourceStrategies, activity);
  propagateMagic(state, field, localSeed, activity);
  if (state.society && changedDoorPairs(doors, field.doors)) state.society.connectionsDirty = true;
}
const changedDoorPairs = (before: MagicField["doors"], after: MagicField["doors"]) =>
  before.length !== after.length ||
  before.some((pair, i) => pair.a !== after[i].a || pair.b !== after[i].b);
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
function applySharedForcing(state: GenerationState, elapsed = false) {
  magicThermalFeedback(state, elapsed);
  magicLivingFeedback(state, elapsed);
  magicOceanFeedback(state);
}
/**
 * The society phase: once people have acted in a cycle, systems made of what they did are
 * evaluated, and systems whose stocks people drew or deposited are located and propagated
 * again, then every system's shared forcing is re-applied. Without people it never runs, so
 * a world with no human era has no society-phase magic and the rest is unchanged.
 */
export function evaluateSocietyMagic(
  state: GenerationState,
  context: MapProcessContext,
  touched: Set<string> = new Set()
) {
  void touched;
  refreshFields(state, context, state.physical!.magic!.fields);
  applySharedForcing(state);
  return true;
}
/** Current dependency order is shared by epoch, present and society evaluation. */
function refreshFields(state: GenerationState, context: MapProcessContext, fields: MagicField[]) {
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
/** Actor events and maintained ground advance only when an actual society cycle elapsed. */
export function advanceSocietyMagic(state: GenerationState, context: MapProcessContext) {
  if (!state.physical?.magic) return;
  const bound = generationBindings(context),
    index = physicalEpochIndex(bound.settings.epochs, context.epochs);
  for (const field of state.physical.magic.fields) {
    const activity = sourceActivity(field, bound.settings.epochs[index]);
    if (field.definition.phase === "society")
      supplyMagicSources(state, field, bound.seed, index, activity);
    supplySocietyEvents(state, field, bound.seed, index, activity);
  }
  evaluateSocietyMagic(state, context);
  hallowedWrites(state);
  hallowedOnTheColumn(state);
}
export function magicProcesses(
  systems: MagicSystem[] = [],
  confluences: MagicConfluence[] = []
): MapProcess[] {
  void confluences;
  const actions: Record<string, (state: GenerationState, context: MapProcessContext) => void> = {
    initialize: (state, context) => {
      const bound = generationBindings(context);
      initializeMagic(
        state,
        bound.features.selection["magic.configured"]?.enabled ?? bound.domains.includes("magic"),
        bound.settings.magicSystems,
        bound.settings.confluences
      );
    },
    // Every evaluation re-applies the shared forcings of all systems, so a system evaluated
    // in the other phase keeps its contribution and a changed one replaces its own.
    climate: (state, context) => {
      evaluateMagic(state, context, "climate", generationBindings(context).seed);
      applySharedForcing(state, context.epochIndices[0] !== undefined);
    },
    rocks: (state, context) => {
      if (context.epochIndices[0] !== undefined) magicRockFeedback(state);
    },
    // Both phases have run by now, so the meetings between systems are evaluated here and
    // act on the ground once per epoch, before ecology responds and the coasts are cut.
    "post-glacial": (state, context) => {
      const seed = generationBindings(context).seed;
      if (context.epochIndices[0] !== undefined) exchangeMagicWater(state);
      evaluateMagic(state, context, "post-glacial", seed);
      applySharedForcing(state, context.epochIndices[0] !== undefined);
      coverSystems(state, seed);
      // Meetings and ground writes act once per epoch. The present phase evaluates the
      // systems and their forcing again but passes no time, so it writes no ground.
      const epoch = context.epochIndices[0];
      evaluateConfluences(state, seed, epoch !== undefined);
      if (epoch === undefined) return;
      stormWrites(state);
      saltWrites(state);
      hallowedWrites(state);
      veilWrites(state, epoch);
      magicOnTheColumn(state, seed, nativeContext(state, context, 0).Span);
    },
    coast: magicCoastalFeedback,
    history: (state, context) => {
      if (context.epochIndices[0] === undefined) return;
      classifyMagicFeatures(state, generationBindings(context).seed);
      recordWildZoneHistory(state, context);
      retainMagicHistory(state, context);
    },
    classify: (state, context) => classifyMagicFeatures(state, generationBindings(context).seed),
    project: projectMagic,
  };
  return Object.entries(actions).map(([id, apply]) => ({
    contract: {
      id: `atlas.magic-${id}`,
      version: "1",
      parameters: {},
      requires: magicRequirements(id, systems),
      produces: [`atlas:magic-${id}`],
      invalidates: [],
      workspaceOnly: id !== "project",
    },
    behavior: magicBehavior(id, apply),
    validate: () => [],
  }));
}
function magicBehavior(
  id: string,
  operation: (state: GenerationState, context: MapProcessContext) => void
): ProcessBehavior {
  if (id === "initialize") return { kind: "initialize", initialize: operation };
  if (id === "project") return { kind: "extract", extract: operation };
  if (["climate", "rocks", "coast"].includes(id))
    return { kind: "forcing-contributor", contribute: operation };
  return { kind: "model-pass", applyPass: operation };
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
  return id === "classify" ? systems.flatMap(conditionRequirements) : [];
}
function systemRequirements(system: MagicSystem) {
  return system.origins.flatMap((origin) => [
    ...magicSourceStrategies[origin.source].requires,
    ...magicPropagationStrategies[origin.propagation].requires,
  ]);
}
function conditionRequirements(system: MagicSystem) {
  const fields: Record<string, string[]> = {
    elevation: ["field:Elevation"],
    slope: ["field:Elevation"],
    temperature: ["field:Temperature"],
    ice: ["field:IceThickness"],
    water: ["field:WaterKindCodes", "field:LakeOutletTargets"],
    moisture: ["field:Moisture"],
    geothermal: ["field:Geothermal"],
    fracture: ["field:FractureConductance"],
    landform: ["field:LandformCodes"],
    river: ["field:RiverOrders"],
    upwelling: ["field:OceanCurrentX"],
  };
  return effectiveMagicRules(system)
    .flatMap((rule) => [...rule.seeds, ...(rule.retains ?? [])].flat())
    .flatMap((condition) =>
      Object.hasOwn(ecologyLabels, condition.field) ? ["ecology"] : (fields[condition.field] ?? [])
    );
}
