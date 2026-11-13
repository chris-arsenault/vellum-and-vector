import type { MapProcessContext } from "../process";
import { nativeContext, physicalContext } from "../world/context";
import { bindOperation, readOperation } from "../processOperation";
import { rivers, drainageFlood, lakes } from "../processes/waterProcesses";
import { drainageConditioning } from "../water/drainageFlood";
import { sourceToOutletOrder } from "../world/flowGraph";
import { lakeBasins } from "../water/lakes";
import { oceanRead } from "../processes/climateProcesses";
import { riverNetwork } from "../water/rivers";
import { releaseWorking, workingValues } from "../world/physicalNumerics";
import { updateSlopes } from "./relief";
import type { RegionalState } from "./state";
import { flowThroughYear } from "../water/waterBalance";
import { naturalBand } from "./state";
import { parentChannels } from "../world/atlasWorkspace";

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
  const map = state.physical.map,
    channelLength = parentChannels(state).has("SmallChannelLength")
      ? naturalBand(state, "SmallChannelLength")
      : undefined;
  let initial = true;
  bindOperation(map, drainageFlood.operation, ({ context }) => {
    updateSlopes(state);
    withIncoming(state, (incoming) => drainageConditioning(map, context, incoming));
  });
  bindOperation(map, lakes.operation, ({ context }) =>
    withIncoming(state, (incoming) => lakeBasins(map, context, incoming))
  );
  bindOperation(map, rivers.operation, ({ context }) => {
    withIncoming(state, (incoming) => {
      const entries = map.rivers.entries,
        catchment = workingValues(map, "float64", "regional:incoming-catchment", () => 0),
        monthly = Array.from({ length: 12 }, (_, month) => {
          const band = workingValues(map, "float64", `regional:incoming-${month}`, () => 0);
          for (const entry of entries) band.add(entry.cell, entry.monthly[month]);
          return band;
        });
      for (const entry of entries) catchment.add(entry.cell, entry.catchment);
      try {
        riverNetwork(map, context, incoming, {
          catchment,
          monthly,
          channelLength: initial ? channelLength : undefined,
        });
        initial = false;
      } finally {
        releaseWorking(map, catchment, ...monthly);
      }
    });
    readDrainage(state);
  });
}

function withIncoming(
  state: RegionalState,
  read: (incoming: import("@atlas/domain").Band) => void
) {
  const map = state.physical.map;
  const incoming = workingValues(map, "float64", "regional:incoming-water", () => 0);
  for (const entry of map.rivers.entries)
    incoming.add(entry.cell, flowThroughYear(entry.monthly, 0).mean);
  try {
    read(incoming);
  } finally {
    releaseWorking(map, incoming);
  }
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
