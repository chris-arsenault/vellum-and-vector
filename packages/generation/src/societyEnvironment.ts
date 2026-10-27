import {
  fieldInterpolator,
  gridPosition,
  putChannel,
  resolutionCells,
  numericalSampleType,
  type NumericalVector,
  type AtlasFeature,
} from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import { generationNetworks, removeGenerationReach } from "./generationNetworks";
import type { PhysicalField } from "./canonry/field";
import { generationBindings } from "./generationBindings";
import { atlasChannels, type ChannelBinding } from "./canonry/atlasChannels";
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
import { channelAccess, coastalFishery } from "./societySupport";
import { initializeMagic } from "./canonry/magicState";
import { propagateMagic } from "./canonry/magicPropagation";
import { classifyMagicFeatures, projectMagic } from "./canonry/magicFeatures";
import { magicChannels } from "./canonry/magicFieldDefinitions";
import { evaluateSocietyMagic } from "./canonry/magicProcesses";
import { systemHasRole } from "./societyMagicAccess";
import { irrigateChannels } from "./societyWaterUse";
import { workSamples } from "./societyWorks";
import { damCandidateCell } from "./societyDemand";
import { isWorldSociety } from "./societyMapScope";
import { regionalIncomingWater } from "./canonry/regionalCorridors";
import { refreshRegionalInfluence } from "./canonry/regionalMagic";
import { generationFeatures, removeGenerationFeature } from "./generationFeatures";

function synchronizeNative(state: GenerationState) {
  for (const name of state.society!.changed) {
    const binding = atlasChannels.find((b) => b.name === name);
    if (!binding) continue;
    synchronizeChannel(state, binding);
  }
  composeNativeAuthoring(state.physical!);
}
function synchronizeChannel(state: GenerationState, binding: ChannelBinding) {
  const { offset = 0, scale } = binding;
  const work = state.physical!,
    map = work.map,
    name = binding.name;
  const before = name === "elevation" ? state.society!.elevationBefore : undefined;
  const at = fieldInterpolator(changedSurface(state, name, before), name),
    values = map[binding.native];
  for (let i = 0; i < map.mesh.count; i++) {
    const sample = at(nativePosition(work, i));
    if (before && sample === 0) continue;
    const value = before ? values[i] + sample / scale : (sample - offset) / scale;
    values[i] = numericalSampleType(values) === "int32" ? Math.round(value) : value;
    if (name === "elevation") {
      if (!before) map.Elevation[i] += map.BaseSeaLevel;
      map.BedrockElevation[i] = map.Elevation[i] - map.SedimentThickness[i];
      // The landscape invariant is exact equality; rebuild the surface from its parts.
      map.Elevation[i] = map.BedrockElevation[i] + map.SedimentThickness[i];
    }
  }
}
function changedSurface(state: GenerationState, name: string, before?: NumericalVector) {
  return before
    ? {
        ...state.surface,
        channels: {
          ...state.surface.channels,
          [name]: state.surface.channels[name].map((value, i) => value - before[i]),
        },
      }
    : state.surface;
}
function refreshWater(state: GenerationState, context: MapProcessContext) {
  const work = state.physical!,
    bound = generationBindings(context);
  const c = physicalContext(bound.seed, 0, work.profile);
  c.SeaLevelOffset = (work.map.EffectiveSeaLevel - work.map.BaseSeaLevel) / 1024;
  work.map.EngineeredDams = new Set(engineeredDamCells(state));
  // Repair present dependencies only. No tectonic motion, incision epochs or new geological events.
  const incoming = state.domain.world.areas[state.domain.scope.areaId].parentId
    ? regionalIncomingWater(state)
    : undefined;
  for (const operation of [
    oceanConnectivity,
    bathymetry,
    oceanDistance,
    oceanCurrents,
    drainageConditioning,
    (map: PhysicalField) => lakeBasins(map, c, incoming),
    drainageGuidance,
    flowRouting,
    (map: PhysicalField) => riverNetwork(map, c, incoming),
    riverChannelGeometry,
  ])
    operation(work.map, c);
}
function* engineeredDamCells(state: GenerationState) {
  for (const work of state.society!.region.works) {
    if (work.kind !== "dam" || work.condition <= 0.1) continue;
    for (const { i } of workSamples(state, work)) yield state.physical!.samples[i];
  }
}
export function refreshSocietyEnvironment(
  state: GenerationState,
  context: MapProcessContext,
  years: number,
  publish = true
) {
  const society = state.society!;
  if ((society.inherited && !society.changed.size) || !context.inputs?.features) return;
  const available = new Set(Object.keys(state.surface.channels));
  ensureEnvironmentalWorkspace(state, context, available);
  const waterChanged = state.physical
    ? refreshNative(state, context, years, available, publish)
    : true;
  registerChangedUnits(state);
  // Channel access and the coast are consequences of the water; they change when it does.
  if (waterChanged) {
    society.river = channelAccess(state);
    society.coast = coastalFishery(state);
  }
  if (society.mediumChanged.has("elevation")) refreshSocietyConnections(state);
  refreshSocietySupport(state);
  society.changed.clear();
  society.mediumChanged.clear();
  releaseElevationBefore(state);
}
function releaseElevationBefore(state: GenerationState) {
  const before = state.society!.elevationBefore;
  if (before?.readBlock) state.numerical?.release(before);
  delete state.society!.elevationBefore;
}
function refreshNative(
  state: GenerationState,
  context: MapProcessContext,
  years: number,
  available: Set<string>,
  publish: boolean
) {
  synchronizeNative(state);
  const water = refreshWaterWhenCaused(state, context, available, publish);
  if (available.has("flow")) irrigateChannels(state);
  refreshMagicPathways(state, context, water.oceanChanged);
  if (available.has("productivity")) advanceHumanEcology(state, context, years);
  projectNative(
    state,
    false,
    false,
    atlasChannels.filter((b) => available.has(b.name)),
    available
  );
  // Numerical feedback runs every cycle; GIS extraction is only needed at publication, and a
  // round inside an earlier epoch publishes nothing: the epoch's own extraction follows.
  if (publish && !state.society!.round) publishEnvironmentalChanges(state, context, available);
  return water.refreshed || available.has("flow");
}
/** Keep scalar units registered when an authored work operates on an inherited field. */
function registerChangedUnits(state: GenerationState) {
  for (const name of state.society!.changed) {
    const values = state.surface.channels[name];
    putChannel(
      state.surface,
      name,
      state.surface.units[name],
      values,
      state.surface.quantities?.[name]
    );
  }
}
/**
 * Water re-routes when a work changed the terrain, not when a practice warmed its seat
 * (ADR 0005). At the era's end the World also tries its dam demands against the water model.
 */
function refreshWaterWhenCaused(
  state: GenerationState,
  context: MapProcessContext,
  available: Set<string>,
  publish: boolean
) {
  const society = state.society!;
  const terrainChanged = society.mediumChanged.has("elevation"),
    realizing = publish && !society.round && isWorldSociety(state);
  if (!available.has("water") || !(terrainChanged || realizing))
    return { oceanChanged: false, refreshed: false };
  const codes = state.physical!.map.WaterKindCodes,
    wasOcean = codes.map((kind) => Number(kind === 1));
  if (realizing) realizeWorldDams(state, context);
  else refreshWater(state, context);
  return {
    oceanChanged: codes.some((kind, i) => Number(kind === 1) !== wasOcean[i]),
    refreshed: true,
  };
}
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
      cell = sample >= 0 ? work.samples[sample] : -1;
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
  const isLake = (i: number) => i >= 0 && map.WaterKindCodes[i] === 2;
  let count = 0;
  while (queue.length) {
    const i = queue.pop()!;
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      if (!isLake(j) || seen.has(j)) continue;
      seen.add(j);
      count++;
      queue.push(j);
    }
  }
  return count;
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
  const physical = generationBindings(context).domains.includes("physical");
  const has = (layer: string) => world.fields.some((f) => f.layerId === layer) || physical;
  dropReplaceableFeatures(state);
  const drainage = world.drainage?.[area];
  extractNativeGeography(state, context, {
    oceans: false,
    impacts: false,
    volcanism: false,
    fractures: false,
    lakes: available.has("water") && has("rivers"),
    landforms: false,
    // People make magic (forges, pans, wards, doors): its places are extracted again after them.
    magic: Boolean(state.physical?.magic?.fields.length) && has("magic"),
    ecology: available.has("productivity") && has("ecology"),
    rivers: available.has("riverOrder"),
    landmarks: false,
  });
  if (!available.has("riverOrder") && drainage) world.drainage![area] = drainage;
}
function refreshMagicPathways(
  state: GenerationState,
  context: MapProcessContext,
  oceanChanged: boolean
) {
  const work = state.physical!;
  const bound = generationBindings(context);
  if (!work.magic) {
    const inherited = Object.keys(state.surface.channels).some((name) => name.startsWith("magic:"));
    if (bound.features.selection["magic.configured"]?.enabled === false && !inherited)
      initializeMagic(state, false);
    else restorePresentMagic(state);
  }
  const seed = bound.seed;
  if (state.domain.world.areas[state.domain.scope.areaId].parentId) {
    refreshRegionalInfluence(state, seed);
    classifyMagicFeatures(state, seed);
    projectMagic(state);
    state.society!.magicTouched?.clear();
    return;
  }
  repropagateMovedMedia(state, seed, oceanChanged);
  // The society phase: systems made of what people did, and systems whose stocks people
  // drew or deposited this cycle (cracked cores at a forge, planted seed, cleared sap).
  const touched = state.society!.magicTouched;
  evaluateSocietyMagic(state, context, touched);
  touched?.clear();
  // Reclassify current interaction conditions; this does not create or replay a historical event.
  classifyMagicFeatures(state, seed);
  if (Object.keys(state.surface.channels).some((name) => name.startsWith("magic:")))
    projectMagic(state);
}
/** Systems whose medium a work moved this cycle propagate again through the moved medium. */
function repropagateMovedMedia(state: GenerationState, seed: number, oceanChanged: boolean) {
  const changed = state.society!.mediumChanged;
  for (const field of state.physical!.magic!.fields) {
    if (!field.definition.enabled) continue;
    // Aurora follows cold and ice: it re-propagates when a work changed that medium, not
    // when a forge warmed the one cell at its seat.
    const cold =
      systemHasRole(field.definition, "stills") &&
      (changed.has("iceThickness") || changed.has("temperature"));
    // Pressure rays trace connected ocean cells. Inland relief does not alter that path;
    // a newly closed or opened coast still requires propagation.
    const coast = systemHasRole(field.definition, "moves-water") && oceanChanged;
    if (cold || coast) propagateMagic(state, field, seed, field.definition.strength);
  }
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
