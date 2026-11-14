import { resolutionCells, type AtlasFeature } from "@atlas/domain";
import { generationBindings } from "../generationBindings";
import { onRiver, waterAt } from "../water/riverKeeping";
import { generationFeatures, removeGenerationFeature } from "../generationFeatures";
import { generationNetworks, removeGenerationReach } from "../generationNetworks";
import { knownPlaces, type KnownPlace } from "./placeRegistry";
import {
  damTried,
  failDam,
  recordDam,
  recordDryDam,
  standingWorks,
  noteWaterMoved,
  takeWaterMoved,
} from "./workRegistry";
import { releaseHeld } from "../poi/poiReads";
import type { GenerationState, MapProcess, MapProcessContext } from "../process";
import { defineCommand, readOperation, runOperation } from "../processOperation";
import { channelForm, riverEvolution } from "../processes/waterProcesses";
import { mapCommand } from "../processTraits";
import { extractNativeGeography } from "../world/atlasFeatures";
import { projectNative, selectedNativeProjection } from "../world/atlasProjection";
import { nativeContext } from "../world/context";
import type { PhysicalField } from "../world/field";
import { releaseWorking, retainedArray, workingArray } from "../world/physicalNumerics";

/**
 * The water people hold back. At the end of each era every living place without a dam tries
 * one on the strongest river cell of its own ground. The land's water is worked out again with
 * the dams marked; a dam that makes lake where there was none, over enough cells for this map
 * to show, stands and is remembered, and the others are withdrawn for a finer map. A dam whose
 * people have gone fails and its water goes with it. Once the eras are done, the lakes and
 * rivers of the map are read again from the water as people left it.
 */
const markDams = defineCommand(
  "human.dam-constraints",
  "work",
  ({ map, cells }: { map: PhysicalField; cells: readonly number[] }) => {
    if (map.EngineeredDams) releaseWorking(map, map.EngineeredDams);
    const dams = cells.length ? retainedArray(map, "uint8", "engineered-dams") : null;
    for (const cell of cells) dams!.set(cell, 1);
    map.EngineeredDams = dams;
  },
  []
);
/** Work the land's water out again with dams standing on these cells. */
function settleWater(state: GenerationState, context: MapProcessContext, cells: readonly number[]) {
  const map = state.physical!.map;
  runOperation(map, markDams, { map, cells });
  readOperation(map, channelForm.operation, { map, context: nativeContext(state, context, 0) });
}
/** Lake cells joined to a dam's cell that were not lake before the dam was tried. */
function impounded(map: PhysicalField, cell: number, lakeBefore: { get(i: number): number }) {
  const seen = new Set<number>(), // hpc-exempt: the few cells of one reservoir
    queue = [cell];
  const filled = (i: number) => i >= 0 && map.WaterKindCodes.get(i) === 2 && !lakeBefore.get(i);
  while (queue.length) {
    const i = queue.pop()!;
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (!filled(j) || seen.has(j)) continue;
      seen.add(j);
      queue.push(j);
    }
  }
  return seen;
}
/** The strongest river cell on or beside a place's ground, or -1 when no river runs there. */
function damSite(map: PhysicalField, place: KnownPlace) {
  let best = -1,
    flow = 0;
  const consider = (i: number) => {
    if (i < 0 || !onRiver(map, i) || map.WaterKindCodes.get(i) !== 0) return;
    const carried = waterAt(map, i);
    if (carried > flow) [best, flow] = [i, carried];
  };
  for (const cell of place.cells) {
    consider(cell);
    for (let edge = 0; edge < map.mesh.degree(cell); edge++)
      consider(map.mesh.neighbor(cell, edge));
  }
  return best;
}
/** Whether a place, or the place that grew over it, is still lived in. */
function lives(places: ReadonlyMap<string, KnownPlace>, id: string) {
  let place = places.get(id);
  while (place?.absorbedBy) place = places.get(place.absorbedBy);
  return Boolean(place && !place.abandoned);
}
/** The dams the living places without one would try, one to a river cell not tried before. */
function trials(state: GenerationState, map: PhysicalField) {
  const dammed = new Set(standingWorks(state).map((work) => work.place)),
    cells = new Set<number>(),
    wanted: { cell: number; place: string }[] = [];
  for (const place of knownPlaces(state)) {
    if (place.abandoned || place.absorbedBy || dammed.has(place.id)) continue;
    const cell = damSite(map, place);
    if (cell < 0 || cells.has(cell) || damTried(state, cell)) continue;
    cells.add(cell);
    wanted.push({ cell, place: place.id });
  }
  return wanted;
}
/** Fail the dams whose people have gone; returns whether any did. */
function failAbandoned(state: GenerationState, era: string) {
  const places = new Map(knownPlaces(state).map((place) => [place.id, place]));
  let failed = false;
  for (const work of standingWorks(state))
    if (!lives(places, work.place)) {
      failDam(state, work, era);
      failed = true;
    }
  return failed;
}
/** The cells of the dams a creator drew on this map: they stand as drawn. */
function drawnDams(state: GenerationState, map: PhysicalField) {
  const cells: number[] = [];
  for (const dam of generationFeatures(state, { areaId: state.domain.scope.areaId, kind: "dam" })) {
    if (dam.state !== "authored" || dam.geometry.type !== "Point") continue;
    const [x, y] = dam.geometry.coordinates,
      cell = map.mesh.cellAt(x - map.mesh.origin[0], y - map.mesh.origin[1]);
    if (cell >= 0) cells.push(cell);
  }
  return cells;
}
/** Every cell a dam stands on: those people raised and still keep, and those a creator drew. */
const dammed = (state: GenerationState, drawn: readonly number[]) => [
  ...standingWorks(state).map((work) => work.cell),
  ...drawn,
];
function advanceWaterworks(state: GenerationState, context: MapProcessContext) {
  const map = state.physical!.map,
    era = context.epochs.at(-1)?.id ?? "present",
    failed = failAbandoned(state, era),
    drawn = drawnDams(state, map),
    // A drawn dam the water has not yet been worked out with.
    unmarked = drawn.some((cell) => !map.EngineeredDams?.get(cell)),
    wanted = trials(state, map),
    changed = failed || unmarked;
  if (unmarked) noteWaterMoved(state);
  if (!wanted.length) {
    if (changed) {
      settleWater(state, context, dammed(state, drawn));
      retainAcceptedWater(state, context);
    }
    return;
  }
  const accepted = tryDams(state, context, wanted, drawn, era);
  if (changed || accepted) retainAcceptedWater(state, context);
  context.progress(1, `${standingWorks(state).length} dams stand; ${lakeCells(map)} cells of lake`);
}

function tryDams(
  state: GenerationState,
  context: MapProcessContext,
  wanted: ReturnType<typeof trials>,
  drawn: readonly number[],
  era: string
) {
  const map = state.physical!.map;
  const lakeBefore = workingArray(map, "uint8", "waterworks:lake-before");
  for (let i = 0; i < map.mesh.count; i++)
    lakeBefore.set(i, map.WaterKindCodes.get(i) === 2 ? 1 : 0);
  settleWater(state, context, [...dammed(state, drawn), ...wanted.map((trial) => trial.cell)]);
  const { dry, accepted } = judgeTrials(state, map, wanted, lakeBefore, era);
  releaseWorking(map, lakeBefore);
  // Leave the water as the dams that stand alone make it.
  if (dry) settleWater(state, context, dammed(state, drawn));
  return accepted > 0;
}
/** Trial reads are hypothetical; only accepted constraints change the retained courses. */
function retainAcceptedWater(state: GenerationState, context: MapProcessContext) {
  const map = state.physical!.map,
    input = { map, context: nativeContext(state, context, 0) };
  runOperation(map, riverEvolution.operation, input);
  readOperation(map, channelForm.operation, input);
}
/** Keep the tried dams that hold a lake this map can show; returns whether any held too little. */
function judgeTrials(
  state: GenerationState,
  map: PhysicalField,
  wanted: readonly { cell: number; place: string }[],
  lakeBefore: { get(i: number): number },
  era: string
) {
  let dry = false,
    accepted = 0;
  // Water one dam already holds is not counted again for the next dam on the same lake.
  const held = new Set<number>(); // hpc-exempt: the cells of an era's new reservoirs
  for (const { cell, place } of wanted) {
    const water = [...impounded(map, cell, lakeBefore)].filter((i) => !held.has(i)),
      holds = water.length;
    if (holds >= resolutionCells) {
      recordDam(state, { cell, place, built: era, holds });
      accepted++;
      for (const i of water) held.add(i);
    } else {
      recordDryDam(state, cell);
      dry = true;
    }
  }
  return { dry, accepted };
}
function lakeCells(map: PhysicalField) {
  let cells = 0;
  for (let i = 0; i < map.mesh.count; i++) if (map.WaterKindCodes.get(i) === 2) cells++;
  return cells;
}
/** A lake or river the generator drew and nobody has since detailed, protected or placed. */
const isGeneratedWater = (feature: AtlasFeature) =>
  ["rivers", "lakes"].includes(feature.layerId) &&
  feature.kind !== "landmark" &&
  feature.state === "generated" &&
  !feature.protected &&
  !(feature.placeId && feature.geometry.type === "Point") &&
  !Object.keys(feature.detail).length;
/** The generated lakes and rivers of this map that nothing else holds onto. */
function dropWaterFeatures(state: GenerationState) {
  const area = state.domain.scope.areaId,
    referenced = new Set<string>(),
    crossed = new Set(
      Object.values(state.domain.world.areas).flatMap(
        (other) => other.boundary?.crossings.map((crossing) => crossing.featureId) ?? []
      )
    );
  for (const feature of generationFeatures(state))
    for (const relation of feature.relations) referenced.add(relation.targetId);
  for (const feature of generationFeatures(state, { areaId: area })) {
    if (!isGeneratedWater(feature) || crossed.has(feature.id) || referenced.has(feature.id))
      continue;
    removeGenerationFeature(state, feature.id);
    for (const reach of generationNetworks(state).reaches({ featureId: feature.id }))
      removeGenerationReach(state, reach.id);
  }
}
/** Read the map's lakes and rivers again from the water as people left it. */
function publishWater(state: GenerationState, context: MapProcessContext) {
  if (!takeWaterMoved(state)) return;
  const map = state.physical!.map,
    selected = generationBindings(context).features.selection,
    rivers = selected["physical.river-networks"]?.enabled === true,
    area = state.domain.scope.areaId,
    drainage = state.domain.world.drainage?.[area];
  // Whatever ran since the dams were last settled may have left the water half worked out:
  // settle it whole before it is drawn.
  settleWater(state, context, dammed(state, drawnDams(state, map)));
  context.progress(0, `Drawing the water people left: ${lakeCells(map)} cells of lake`);
  runOperation(map, projectNative, selectedNativeProjection(state, context));
  releaseHeld(state);
  dropWaterFeatures(state);
  runOperation(map, extractNativeGeography, {
    state,
    context,
    deliveries: {
      oceans: false,
      impacts: false,
      volcanism: false,
      fractures: false,
      lakes: selected["water.routing"]?.enabled === true,
      landforms: false,
      ecology: false,
      rivers,
      landmarks: false,
    },
  });
  if (!rivers && drainage) state.domain.world.drainage![area] = drainage;
}
const contract = (id: string, workspaceOnly: boolean) => ({
  id,
  version: "1",
  parameters: {},
  requires: ["atlas:workspace"],
  produces: [],
  invalidates: [],
  workspaceOnly,
});
export const humanWaterworks: MapProcess = {
  contract: contract("human.waterworks", true),
  operation: mapCommand("human.waterworks", "event", advanceWaterworks, []),
  validate: () => [],
};
export const humanWaterPresent: MapProcess = {
  contract: contract("human.water-present", false),
  operation: mapCommand("human.water-present", "publish", publishWater, []),
  validate: () => [],
};
export const waterworksProcesses = [humanWaterworks, humanWaterPresent];
