import {
  fieldInterpolator,
  gridPosition,
  putChannel,
  resolutionCells,
  fillBand,
  fieldChannelName,
  type AtlasFeature,
  type Band,
  type FieldChannelName,
} from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import { generationNetworks, removeGenerationReach } from "./generationNetworks";
import { isMutablePhysicalName, type PhysicalField } from "./world/field";
import { releaseWorking, retainedArray } from "./world/physicalNumerics";
import { generationBindings } from "./generationBindings";
import { physicalChannels, type PhysicalChannel } from "./world/atlasChannels";
import { composeNativeAuthoring, nativePosition } from "./world/atlasWorkspace";
import { projectNative } from "./world/atlasProjection";
import { extractNativeGeography } from "./world/atlasFeatures";
import { refreshOceans } from "./world/oceanFeatures";
import { nativeContext } from "./world/context";
import { oceanRead, seaFloorZones, shoreDistance, currents } from "./processes/climateProcesses";
import { advanceHumanEcology } from "./world/ecologyProcesses";
import { refreshSocietySupport, refreshSocietyConnections } from "./societyGeography";
import { channelAccess, coastalFishery } from "./societySupport";
import { magicChannels } from "./world/magicFieldDefinitions";
import {
  classifyCurrentMagic,
  evaluateSocietyMagic,
  initializeMagicWorkspace,
  publishCurrentMagic,
} from "./world/magicProcesses";
import { irrigateChannels } from "./societyWaterUse";
import { defineCommand, readOperation, runOperation } from "./processOperation";
import { executeMapOperation, mapCommand, processOwner } from "./processTraits";
import type { SocietyInput } from "./societyOperation";
import { rivers, channelForm } from "./processes/waterProcesses";
import { workSamples } from "./societyWorks";
import { damCandidateCell } from "./societyDemand";
import { isWorldSociety } from "./societyMapScope";
import { generationFeatures, removeGenerationFeature } from "./generationFeatures";
import { standGround, looseTo } from "./rock/groundLedger";
import { alterRock } from "./rock/rockField";

const synchronizeNative = defineCommand("human.synchronize", "work", synchronize, []);
function synchronize(state: GenerationState) {
  for (const name of state.society!.changed) {
    const binding = physicalChannels.find((b) => b.name === name);
    if (!binding) continue;
    synchronizeChannel(state, binding);
  }
  composeNativeAuthoring(state.physical!);
}
function synchronizeChannel(state: GenerationState, binding: PhysicalChannel) {
  const work = state.physical!,
    map = work.map,
    name = binding.name;
  const before = name === "Elevation" ? state.society!.elevationBefore : undefined;
  const surface = changedSurface(state, name, before),
    at = fieldInterpolator(surface, name),
    values = map[name],
    integer = values.type === "int32";
  for (let i = 0; i < map.mesh.count; i++) {
    const sample = at(nativePosition(work, i));
    if (before && sample === 0) continue;
    const value = before ? values.get(i) + sample : sample;
    synchronizeValue(map, name, i, integer ? Math.round(value) : value);
  }
  if (surface !== state.surface) state.surface.coverage.release(surface.channels[name]!);
}
function synchronizeValue(
  map: PhysicalField,
  name: PhysicalChannel["name"],
  i: number,
  value: number
) {
  if (name === "Elevation") standGround(map, i, value, "society");
  else if (name === "BedrockElevation")
    standGround(map, i, value + map.SedimentThickness.get(i), "society");
  else if (name === "RockResistance") alterRock(map, i, value - map[name].get(i));
  else if (name === "SedimentThickness") looseTo(map, i, value, "society");
  else if (isMutablePhysicalName(name)) map[name].set(i, value);
  else throw new Error(`Society ground change requires an owner operation: ${name}`);
}
function changedSurface(state: GenerationState, name: FieldChannelName, before?: Band) {
  if (!before) return state.surface;
  const current = state.surface.channels[name]!;
  return {
    ...state.surface,
    channels: {
      ...state.surface.channels,
      [name]: fillBand(
        state.surface.coverage.scratch(current.type, `society-change:${name}`, current.length),
        (i) => current.get(i) - before.get(i)
      ),
    },
  };
}
function refreshWater(state: GenerationState, context: MapProcessContext) {
  const work = state.physical!,
    c = nativeContext(state, context, 0);
  runOperation(processOwner(state), markEngineeredDams, state);
  for (const process of [oceanRead, seaFloorZones, shoreDistance, currents, channelForm])
    readOperation(work.map, process.operation, { map: work.map, context: c });
}
const markEngineeredDams = defineCommand(
  "human.dam-constraints",
  "work",
  (state: GenerationState) => {
    const work = state.physical!;
    if (work.map.EngineeredDams) releaseWorking(work.map, work.map.EngineeredDams);
    let dams: Band | null = null;
    for (const i of engineeredDamCells(state))
      (dams ??= retainedArray(work.map, "uint8", "engineered-dams")).set(i, 1);
    work.map.EngineeredDams = dams;
  },
  []
);
function* engineeredDamCells(state: GenerationState) {
  for (const work of state.society!.region.works) {
    if (work.kind !== "dam" || work.condition <= 0.1) continue;
    for (const { i } of workSamples(state, work)) yield state.physical!.samples.get(i);
  }
}
export const refreshSocietyEnvironment = mapCommand(
  "human.environment-current",
  "event",
  (state, context) => settleEnvironment(state, context, 0),
  []
);
export const advanceSocietyEnvironment = defineCommand(
  "human.environment",
  "elapsed",
  ({ state, context, years, publish }: SocietyInput) =>
    settleEnvironment(state, context, years, publish),
  []
);
function settleEnvironment(
  state: GenerationState,
  context: MapProcessContext,
  years: number,
  publish = true
) {
  const society = state.society!;
  if ((society.inherited && !society.changed.size) || !context.inputs?.features) return;
  const available = new Set(Object.keys(state.surface.channels).map(fieldChannelName));
  const waterChanged = refreshNative(state, context, years, available, publish);
  registerChangedUnits(state);
  // Channel access and the coast are consequences of the water; they change when it does.
  if (waterChanged) {
    society.river = channelAccess(state);
    society.coast = coastalFishery(state);
  }
  if (society.mediumChanged.has("Elevation") || society.connectionsDirty)
    runOperation(processOwner(state), refreshSocietyConnections, state);
  refreshSocietySupport(state);
  society.changed.clear();
  society.mediumChanged.clear();
  releaseElevationBefore(state);
}
function releaseElevationBefore(state: GenerationState) {
  const before = state.society!.elevationBefore;
  if (before) state.surface.coverage.release(before);
  delete state.society!.elevationBefore;
}
function refreshNative(
  state: GenerationState,
  context: MapProcessContext,
  years: number,
  available: Set<FieldChannelName>,
  publish: boolean
) {
  const owner = processOwner(state);
  runOperation(owner, synchronizeNative, state);
  const waterChanged = waterNeedsRefresh(state, available, publish);
  if (waterChanged) runOperation(owner, refreshWaterWhenCaused, { state, context, publish });
  if (available.has("FlowAccumulation")) {
    runOperation(owner, irrigateChannels, state);
    const work = state.physical!,
      c = nativeContext(state, context, 0);
    readOperation(work.map, rivers.operation, { map: work.map, context: c });
  }
  refreshMagicPathways(state, context);
  if (available.has("Productivity") && years > 0)
    runOperation(processOwner(state), advanceHumanEcology, { state, context, years });
  runOperation(owner, projectNative, {
    state,
    channels: physicalChannels.filter((b) => available.has(b.name)),
    selectedChannels: available,
  });
  // Numerical feedback runs every cycle; GIS extraction is only needed at publication, and a
  // round inside an earlier epoch publishes nothing: the epoch's own extraction follows.
  if (publish && !state.society!.round) publishEnvironmentalChanges(state, context, available);
  return waterChanged || available.has("FlowAccumulation");
}
/** Keep scalar units registered when an authored work operates on an inherited field. */
function registerChangedUnits(state: GenerationState) {
  for (const name of state.society!.changed) {
    const values = state.surface.channels[name]!;
    putChannel(
      state.surface,
      name,
      state.surface.units[name]!,
      values,
      state.surface.quantities?.[name]
    );
  }
}
/**
 * Water re-routes when a work changed the terrain, not when a practice warmed its seat
 * (ADR 0005). At the era's end the World also tries its dam demands against the water model.
 */
function waterNeedsRefresh(state: GenerationState, available: Set<string>, publish: boolean) {
  const society = state.society!;
  const terrainChanged = society.mediumChanged.has("Elevation"),
    realizing = publish && !society.round && isWorldSociety(state);
  return available.has("WaterKindCodes") && (terrainChanged || realizing);
}
const refreshWaterWhenCaused = defineCommand(
  "human.water-current",
  "work",
  ({
    state,
    context,
    publish,
  }: {
    state: GenerationState;
    context: MapProcessContext;
    publish: boolean;
  }) => {
    if (publish && !state.society!.round && isWorldSociety(state)) realizeWorldDams(state, context);
    else refreshWater(state, context);
  },
  []
);
/**
 * The resolution rule applied to the one structure World can measure. At the era's end each
 * dam demand is tried on its unit's strongest channel cell: when the impoundment the water
 * model gives it spans the declared number of mesh cells, the dam is realized at World with
 * its lake; otherwise the cell is withdrawn and the demand stays latent for a finer profile.
 */
function realizeWorldDams(state: GenerationState, context: MapProcessContext) {
  const society = state.society!,
    work = state.physical!,
    map = work.map;
  const demands = society.region.works.filter((w) => w.kind === "dam" && w.demand);
  for (const dam of demands) {
    const sample = damCandidateCell(state, dam),
      cell = sample >= 0 && sample < work.samples.length ? work.samples.get(sample) : -1;
    if (cell === undefined || cell < 0) continue;
    const demand = dam.demand!,
      seat = dam.position;
    dam.position = gridPosition(state.surface, sample);
    delete dam.demand;
    refreshWater(state, context);
    const span = impoundmentCells(map, cell);
    if (span >= resolutionCells) {
      dam.applied = 0;
      dam.causes.push(
        `Realized at World: the dam the unit demanded impounds ${span} mesh cells on its strongest channel, so the mesh resolves it.`
      );
      continue;
    }
    dam.position = seat;
    dam.demand = demand;
  }
  // Leave the water as the realized dams alone make it.
  refreshWater(state, context);
}
/** Lake cells connected to the dam's cell through the mesh, after the water model ran. */
function impoundmentCells(map: PhysicalField, cell: number) {
  const seen = new Set<number>(),
    queue = [cell];
  const isLake = (i: number) => i >= 0 && map.WaterKindCodes.get(i) === 2;
  let count = 0;
  while (queue.length) {
    const i = queue.pop()!;
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (!isLake(j) || seen.has(j)) continue;
      seen.add(j);
      count++;
      queue.push(j);
    }
  }
  return count;
}
/**
 * The generated river, lake, ecology and magic features of this area that nothing else
 * holds onto are dropped before the surface is extracted again after people acted.
 */
export function dropReplaceableFeatures(state: GenerationState) {
  const area = state.domain.scope.areaId;
  const referenced = new Set<string>();
  for (const feature of generationFeatures(state))
    for (const relation of feature.relations) referenced.add(relation.targetId);
  for (const f of generationFeatures(state, { areaId: area })) {
    if (!replaceableFeature(state, f, referenced)) continue;
    removeGenerationFeature(state, f.id);
    for (const reach of generationNetworks(state).reaches({ featureId: f.id }))
      removeGenerationReach(state, reach.id);
  }
}
function replaceableFeature(
  state: GenerationState,
  feature: AtlasFeature,
  referenced: Set<string>
) {
  return (
    feature.kind !== "landmark" &&
    !(feature.placeId && feature.geometry.type === "Point") &&
    ["rivers", "lakes", "ecology", "magic"].includes(feature.layerId) &&
    feature.state === "generated" &&
    !feature.protected &&
    !Object.values(state.domain.world.areas).some((area) =>
      area.boundary?.crossings.some((c) => c.featureId === feature.id)
    ) &&
    !referenced.has(feature.id) &&
    !Object.keys(feature.detail).length
  );
}
function publishEnvironmentalChanges(
  state: GenerationState,
  context: MapProcessContext,
  available: Set<string>
) {
  const world = state.domain.world,
    area = state.domain.scope.areaId;
  dropReplaceableFeatures(state);
  const drainage = world.drainage?.[area];
  const ocean = state.surface.ocean;
  runOperation(processOwner(state), extractNativeGeography, {
    state,
    context,
    deliveries: {
      oceans: false,
      impacts: false,
      volcanism: false,
      fractures: false,
      lakes: available.has("WaterKindCodes"),
      landforms: false,
      ecology: available.has("Productivity"),
      rivers: available.has("RiverOrders"),
      landmarks: false,
    },
  });
  refreshOceans(
    state,
    ocean,
    generationBindings(context).features.selection["ocean.geography"]?.enabled === true
  );
  if (!available.has("RiverOrders") && drainage) world.drainage![area] = drainage;
}
function refreshMagicPathways(state: GenerationState, context: MapProcessContext) {
  if (!state.physical!.magic) executeMapOperation(preparePresentMagic, state, context);
  // Current reads follow initialization and each independent material command.
  const touched = state.society!.magicTouched;
  executeMapOperation(evaluateSocietyMagic, state, context);
  touched?.clear();
  executeMapOperation(classifyCurrentMagic, state, context);
  if (Object.keys(state.surface.channels).some((name) => name.startsWith("magic:")))
    executeMapOperation(publishCurrentMagic, state, context);
}
const preparePresentMagic = mapCommand(
  "human.magic-initialize",
  "initialize",
  (state, context) => {
    const bound = generationBindings(context);
    const inherited = Object.keys(state.surface.channels).some((name) => name.startsWith("magic:"));
    if (bound.features.selection["magic.configured"]?.enabled === false && !inherited)
      runOperation(processOwner(state), initializeMagicWorkspace, { state, enabled: false });
    else restorePresentMagic(state);
  },
  []
);
function restorePresentMagic(state: GenerationState) {
  runOperation(processOwner(state), initializeMagicWorkspace, { state });
  const work = state.physical!;
  for (const field of work.magic!.fields)
    for (const channel of magicChannels) {
      const name = `magic:${field.definition.id}:${channel}` as const;
      if (!state.surface.channels[name]) continue;
      const at = fieldInterpolator(state.surface, name);
      for (let i = 0; i < work.map.mesh.count; i++)
        field[channel].set(i, at(nativePosition(work, i)));
    }
}
