import type { MapProcessContext } from "../process";
import { nativeContext, physicalContext } from "../world/context";
import { bindOperation, readOperation } from "../processOperation";
import {
  rivers,
  riverEvolution,
  drainageFlood,
  lakes,
  type RiverEvolutionInput,
} from "../processes/waterProcesses";
import { drainageConditioning } from "../water/drainageFlood";
import { sourceToOutletOrder } from "../world/flowGraph";
import { lakeBasins } from "../water/lakes";
import { oceanRead } from "../processes/climateProcesses";
import { riverNetwork } from "../water/rivers";
import { releaseWorking } from "../world/physicalNumerics";
import { updateSlopes } from "./relief";
import type { RegionalState } from "./state";
import { naturalBand } from "./state";
import { parentChannels } from "../world/atlasWorkspace";
import { runOperation } from "../processOperation";
import { withBoundaryFlow } from "../water/boundaryWater";

/**
 * Resolve present water with the shared owners. The regional boundary contributes captured
 * inflow, but supplies no alternate lake budget, channel loss or shore material. This read
 * refresh does not advance groundwater, ice, sediment or an epoch.
 */
export function routeWater(state: RegionalState, context?: MapProcessContext) {
  const c = context
    ? nativeContext(state, context, 0)
    : physicalContext(state.regional.input.seed, 0, state.physical.profile);
  readOperation(state.physical.map, rivers.operation, { map: state.physical.map, context: c });
}

/** Same current-water interface, with captured incoming flow as the regional strategy. */
export function bindRegionalWater(state: RegionalState) {
  const map = state.physical.map;
  bindOperation(map, drainageFlood.operation, ({ context }) => {
    updateSlopes(state);
    withBoundaryFlow(map, (incoming) => drainageConditioning(map, context, incoming));
  });
  bindOperation(map, lakes.operation, ({ context }) =>
    withBoundaryFlow(map, (incoming) => lakeBasins(map, context, incoming))
  );
  bindOperation(map, rivers.operation, ({ context }) => {
    riverNetwork(map, context);
    readDrainage(state);
  });
}

/** Development, unlike a current read, can change the retained network. */
export function developRegionalWater(state: RegionalState, context: MapProcessContext) {
  evolveRegionalWater(state, context);
}

/** Captured latent channels participate once, through an explicit initialization occurrence. */
export function initializeRegionalWater(state: RegionalState, context: MapProcessContext) {
  const channelLength = parentChannels(state).has("SmallChannelLength")
    ? naturalBand(state, "SmallChannelLength")
    : undefined;
  evolveRegionalWater(state, context, channelLength);
}

function evolveRegionalWater(
  state: RegionalState,
  context: MapProcessContext,
  channelLength?: RiverEvolutionInput["channelLength"]
) {
  const map = state.physical.map,
    input: RiverEvolutionInput = { map, context: nativeContext(state, context, 0), channelLength };
  runOperation(map, riverEvolution.operation, input);
  routeWater(state, context);
}

/** Ocean connection is selected by the ocean feature, independently of inland routing. */
export function refreshRegionalOcean(state: RegionalState, context?: MapProcessContext) {
  const c = context
    ? nativeContext(state, context, 0)
    : physicalContext(state.regional.input.seed, 0, state.physical.profile);
  readOperation(state.physical.map, oceanRead.operation, { map: state.physical.map, context: c });
}

/** Regional readers consume the same current routing graph as the material carriers. */
function readDrainage(state: RegionalState) {
  const map = state.physical.map,
    sourceFirst = sourceToOutletOrder(map),
    order = new Int32Array(map.mesh.count),
    receiver = new Int32Array(map.mesh.count);
  for (let i = 0; i < map.mesh.count; i++) {
    receiver[i] = map.FlowTargets.get(i);
    order[i] = sourceFirst.get(map.mesh.count - 1 - i);
  }
  releaseWorking(map, sourceFirst);
  state.regional.drainage = { receiver, order, count: map.mesh.count };
}
