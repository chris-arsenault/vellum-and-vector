import { fieldInterpolator, putChannel } from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import { generationBindings } from "./generationBindings";
import { atlasChannels } from "./canonry/atlasChannels";
import {
  composeNativeAuthoring,
  createAtlasWorkspace,
  nativePosition,
} from "./canonry/atlasWorkspace";
import { projectNative } from "./canonry/atlasProjection";
import { extractNativeGeography } from "./canonry/atlasFeatures";
import { physicalContext } from "./canonry/context";
import { oceanConnectivity } from "./canonry/ocean";
import { bathymetry, oceanDistance } from "./canonry/geography";
import { drainageConditioning } from "./canonry/drainageFlood";
import { lakeBasins } from "./canonry/lakes";
import { drainageGuidance } from "./canonry/flowGuidance";
import { flowRouting } from "./canonry/routing";
import { riverNetwork } from "./canonry/rivers";
import { riverChannelGeometry } from "./canonry/channelGeometry";
import { oceanCurrents } from "./canonry/currents";
import { advanceHumanEcology } from "./canonry/ecologyProcesses";
import { refreshSocietySupport, refreshSocietyConnections } from "./societyGeography";
import { channelAccess } from "./societySupport";
import { initializeMagic } from "./canonry/magicState";
import { propagateMagic } from "./canonry/magicPropagation";
import { classifyMagicFeatures, projectMagic } from "./canonry/magicFeatures";
import { magicChannels } from "./canonry/magicFieldDefinitions";
import { irrigateChannels } from "./societyWaterUse";
import { workSamples } from "./societyWorks";

function synchronizeNative(state: GenerationState) {
  const work = state.physical!,
    map = work.map;
  for (const name of state.society!.changed) {
    const binding = atlasChannels.find((b) => b.name === name);
    if (!binding) continue;
    const at = fieldInterpolator(state.surface, name),
      values = map[binding.native];
    for (let i = 0; i < map.mesh.count; i++) {
      const value = (at(nativePosition(work, i)) - (binding.offset ?? 0)) / binding.scale;
      values[i] = values instanceof Int32Array ? Math.round(value) : value;
      if (name === "elevation") {
        map.Elevation[i] += map.BaseSeaLevel;
        map.BedrockElevation[i] = map.Elevation[i] - map.SedimentThickness[i];
      }
    }
  }
  composeNativeAuthoring(work);
}
function refreshWater(state: GenerationState, context: MapProcessContext) {
  const work = state.physical!,
    bound = generationBindings(context);
  const c = physicalContext(bound.seed, 0, work.profile);
  c.SeaLevelOffset = (work.map.EffectiveSeaLevel - work.map.BaseSeaLevel) / 1024;
  work.map.EngineeredDams = new Set(
    state
      .society!.region.works.filter((w) => w.kind === "dam" && w.condition > 0.1)
      .flatMap((w) => workSamples(state, w).map(({ i }) => work.samples[i]))
  );
  // Repair present dependencies only. No tectonic motion, incision epochs or new geological events.
  for (const operation of [
    oceanConnectivity,
    bathymetry,
    oceanDistance,
    oceanCurrents,
    drainageConditioning,
    lakeBasins,
    drainageGuidance,
    flowRouting,
    riverNetwork,
    riverChannelGeometry,
  ])
    operation(work.map, c);
}
export function refreshSocietyEnvironment(
  state: GenerationState,
  context: MapProcessContext,
  years: number
) {
  const society = state.society!;
  if ((society.inherited && !society.changed.size) || !context.inputs?.features) return;
  const available = new Set(Object.keys(state.surface.channels));
  ensureEnvironmentalWorkspace(state, context, available);
  if (state.physical) refreshNative(state, context, years, available);
  // Keep scalar units registered when an authored work operates on an inherited field.
  for (const name of society.changed) {
    const values = state.surface.channels[name];
    putChannel(
      state.surface,
      name,
      state.surface.units[name],
      values,
      state.surface.quantities?.[name]
    );
  }
  society.river = channelAccess(state);
  if (society.changed.has("elevation")) refreshSocietyConnections(state);
  refreshSocietySupport(state);
  society.changed.clear();
}
function refreshNative(
  state: GenerationState,
  context: MapProcessContext,
  years: number,
  available: Set<string>
) {
  synchronizeNative(state);
  if (available.has("water") && state.society!.changed.has("elevation"))
    refreshWater(state, context);
  if (available.has("flow")) irrigateChannels(state);
  refreshMagicPathways(state, context);
  if (available.has("productivity")) advanceHumanEcology(state, context, years);
  projectNative(
    state,
    false,
    false,
    atlasChannels.filter((b) => available.has(b.name)),
    available
  );
  publishEnvironmentalChanges(state, context, available);
}
function ensureEnvironmentalWorkspace(
  state: GenerationState,
  context: MapProcessContext,
  available: Set<string>
) {
  if (state.physical || !(available.has("productivity") || available.has("water"))) return;
  const bound = generationBindings(context);
  state.physical = createAtlasWorkspace(
    state,
    bound.quality as "draft" | "standard" | "fine",
    bound.parameters
  );
}
function publishEnvironmentalChanges(
  state: GenerationState,
  context: MapProcessContext,
  available: Set<string>
) {
  const world = state.domain.world,
    area = state.domain.scope.areaId;
  const physical = generationBindings(context).domains.includes("physical");
  const has = (layer: string) => world.fields.some((f) => f.layerId === layer) || physical;
  const previous = Object.values(world.features).filter(
    (f) =>
      f.areaId === area &&
      ["rivers", "lakes", "ecology"].includes(f.layerId) &&
      f.state === "generated" &&
      !f.protected &&
      !Object.values(world.areas).some((a) =>
        a.boundary?.crossings.some((c) => c.featureId === f.id)
      ) &&
      !Object.values(world.features).some((other) =>
        other.relations.some((r) => r.targetId === f.id)
      ) &&
      !Object.keys(f.detail).length
  );
  for (const f of previous) {
    delete world.features[f.id];
    for (const r of Object.values(world.networkReaches ?? {}))
      if (r.featureId === f.id) delete world.networkReaches![r.id];
  }
  const drainage = world.drainage?.[area];
  extractNativeGeography(state, context, {
    impacts: false,
    volcanism: false,
    fractures: false,
    lakes: available.has("water") && has("rivers"),
    landforms: false,
    magic: false,
    ecology: available.has("productivity") && has("ecology"),
    rivers: available.has("riverOrder"),
  });
  if (!available.has("riverOrder") && drainage) world.drainage![area] = drainage;
}
function refreshMagicPathways(state: GenerationState, context: MapProcessContext) {
  const work = state.physical!,
    changed = state.society!.changed;
  if (!work.magic) restorePresentMagic(state);
  const seed = generationBindings(context).seed;
  for (const field of work.magic!.fields) {
    if (!field.definition.enabled) continue;
    const cold =
      field.definition.propagation === "cold-drainage" &&
      (changed.has("iceThickness") || changed.has("temperature"));
    const coast = field.definition.propagation === "ocean-rays" && changed.has("elevation");
    if (cold || coast) propagateMagic(state, field, seed, field.definition.strength);
  }
  // Reclassify current interaction conditions; this does not create or replay a historical event.
  classifyMagicFeatures(state, seed);
  if (Object.keys(state.surface.channels).some((name) => name.startsWith("magic:")))
    projectMagic(state);
}
function restorePresentMagic(state: GenerationState) {
  initializeMagic(state);
  const work = state.physical!;
  for (const field of work.magic!.fields)
    for (const channel of magicChannels) {
      const name = `magic:${field.definition.id}:${channel}`;
      if (!state.surface.channels[name]) continue;
      const at = fieldInterpolator(state.surface, name);
      for (let i = 0; i < work.map.mesh.count; i++) field[channel][i] = at(nativePosition(work, i));
    }
}
