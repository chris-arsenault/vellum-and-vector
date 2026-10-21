import { putChannel, requireThat, type Grid } from "@atlas/domain";
import { requireChannel } from "./mapFields";
import { conditionDrainage, routeRunoff, writeDrainage } from "./mapDrainage";
import {
  cellDistance,
  checkProgress,
  epochYears,
  movableTerrain,
  secondsPerYear,
} from "./mapLattice";
import type { MapProcess, MapProcessContext } from "./process";

export const drainageProcess: MapProcess = {
  contract: {
    id: "hydrology.drainage",
    version: "1",
    requires: ["elevation", "rainfall"],
    produces: ["drainage", "runoff", "flow", "lakes"],
    invalidates: [],
    parameters: {
      seaLevel: { type: "number", unit: "metre", required: false, default: 0 },
      evaporation: {
        type: "number",
        unit: "metre/year",
        required: false,
        default: 0.2,
        minimum: 0,
      },
      runoffFraction: {
        type: "number",
        unit: "ratio",
        required: false,
        default: 0.65,
        minimum: 0,
        maximum: 1,
      },
      meltwaterYears: { type: "number", unit: "year", required: false, default: 1, minimum: 0.001 },
    },
  },
  behavior: {
    kind: "model-pass",
    applyPass(state, context) {
      const level = Number(context.parameters.seaLevel),
        graph = conditionDrainage(state.surface, level, context);
      routeRunoff(state, graph, context);
      writeDrainage(state.surface, graph, level);
    },
  },
  validate(state) {
    validateDrainage(state.surface);
    return [];
  },
};

function validateDrainage(grid: Grid) {
  const floor = requireChannel(grid, "elevation", "metre"),
    filled = requireChannel(grid, "drainageElevation", "metre");
  const targets = requireChannel(grid, "receiver", "cell-index"),
    rank = requireChannel(grid, "drainageRank", "cell-index");
  const flow = requireChannel(grid, "flow", "cubic-metre/second");
  for (let i = 0; i < floor.length; i++) {
    if (!grid.active[i]) continue;
    const target = targets[i];
    requireThat(
      filled[i] >= floor[i] && flow[i] >= 0,
      "invalid_drainage",
      "Drainage retains the floor and nonnegative discharge."
    );
    requireThat(
      target === -1 ||
        (Number.isInteger(target) &&
          grid.active[target] === 1 &&
          rank[target] < rank[i] &&
          filled[target] <= filled[i]),
      "drainage_cycle",
      "Each reach drains to a lower-ranked active receiver."
    );
  }
}

// Adapted from Canonry's fluvial-incision and sediment-transport passes: loose
// cover is removed before bedrock, sediment moves source-to-outlet, and falling
// carrying capacity deposits it. Volumes use actual clipped cell areas.
export const erosionProcess: MapProcess = {
  contract: {
    id: "physical.erosion",
    version: "1",
    requires: ["elevation", "geology", "drainage", "flow"],
    produces: ["elevation", "geology", "sediment"],
    invalidates: [
      "temperature",
      "precipitation",
      "rainfall",
      "snowfall",
      "moisture",
      "drainage",
      "runoff",
      "flow",
      "lakes",
    ],
    parameters: {
      erodibility: {
        type: "number",
        unit: "metre/year/sqrt(cubic-metre/second)",
        required: false,
        default: 0.015,
        minimum: 0,
      },
      transportConcentration: {
        type: "number",
        unit: "cubic-metre/cubic-metre",
        required: false,
        default: 0.0005,
        minimum: 0,
      },
      depositionFraction: {
        type: "number",
        unit: "ratio",
        required: false,
        default: 0.5,
        minimum: 0,
        maximum: 1,
      },
    },
  },
  behavior: {
    kind: "model-pass",
    applyPass(state, context) {
      validateDrainage(state.surface);
      for (const channel of ["bedrock", "sediment"])
        requireChannel(state.surface, channel, "metre");
      requireChannel(state.surface, "rock", "ratio");
      const grid = state.surface,
        mobile = movableTerrain(state),
        years = epochYears(context);
      const moving = new Float64Array(grid.active.length),
        eroded = new Float64Array(grid.active.length),
        deposited = new Float64Array(grid.active.length);
      const order = Array.from(grid.active.keys())
        .filter((i) => grid.active[i])
        .sort((a, b) => grid.channels.drainageRank[b] - grid.channels.drainageRank[a]);
      let exported = 0;
      for (let n = 0; n < order.length; n++) {
        checkProgress(
          context,
          n,
          order.length,
          "Eroding material and depositing downstream sediment"
        );
        const i = order[n],
          target = grid.channels.receiver[i];
        const supply = removeMaterial(grid, i, target, mobile[i] === 1, years, context);
        eroded[i] = supply;
        const load = moving[i] + supply;
        const retained = depositMaterial(grid, i, target, load, mobile[i] === 1, years, context);
        deposited[i] = retained;
        if (target >= 0) moving[target] += load - retained;
        else exported += load - retained;
      }
      recordTransport(grid, eroded, deposited, exported, context);
    },
  },
  validate(state) {
    requireChannel(state.surface, "bedrock", "metre");
    const sediment = requireChannel(state.surface, "sediment", "metre");
    requireThat(
      sediment.every((v) => v >= 0),
      "negative_sediment",
      "Transport cannot remove more loose sediment than exists."
    );
    return [];
  },
};

function removeMaterial(
  grid: Grid,
  i: number,
  target: number,
  movable: boolean,
  years: number,
  context: MapProcessContext
) {
  if (!movable || target < 0 || grid.measures[i] <= 0) return 0;
  const elevation = grid.channels.elevation,
    bedrock = grid.channels.bedrock,
    sediment = grid.channels.sediment;
  const rock = grid.channels.rock,
    flow = grid.channels.flow[i];
  const fall = Math.max(0, elevation[i] - elevation[target]);
  const slope = fall / Math.max(1, cellDistance(grid, i, target));
  const depth = Math.min(
    fall * 0.35,
    (Number(context.parameters.erodibility) *
      Math.sqrt(flow) *
      slope *
      years *
      (1 + (grid.channels.coastalPressure?.[i] ?? 0) / 1000)) /
      Math.max(0.1, rock[i])
  );
  const loose = Math.min(sediment[i], depth);
  sediment[i] -= loose;
  bedrock[i] -= depth - loose;
  elevation[i] -= depth;
  return depth * grid.measures[i];
}
function depositMaterial(
  grid: Grid,
  i: number,
  target: number,
  load: number,
  movable: boolean,
  years: number,
  context: MapProcessContext
) {
  if (!movable || load <= 0 || grid.measures[i] <= 0) return 0;
  const elevation = grid.channels.elevation;
  const slope =
    target < 0
      ? 0
      : Math.max(0, elevation[i] - elevation[target]) / Math.max(1, cellDistance(grid, i, target));
  const concentration = Number(context.parameters.transportConcentration);
  const capacity =
    grid.channels.flow[i] * secondsPerYear * years * concentration * Math.sqrt(slope);
  const fraction = grid.channels.water[i] > 0 ? 1 : Number(context.parameters.depositionFraction);
  const volume = Math.max(0, load - capacity) * fraction;
  grid.channels.sediment[i] += volume / grid.measures[i];
  elevation[i] += volume / grid.measures[i];
  return volume;
}
function recordTransport(
  grid: Grid,
  removed: Float64Array,
  retained: Float64Array,
  exported: number,
  context: MapProcessContext
) {
  const eroded = removed.reduce((sum, v) => sum + v, 0),
    deposited = retained.reduce((sum, v) => sum + v, 0);
  requireThat(
    Math.abs(eroded - deposited - exported) <= Math.max(1e-7, eroded * 1e-10),
    "sediment_balance",
    "Every eroded cubic metre must be deposited or exported."
  );
  putChannel(
    grid,
    "erosion",
    "metre",
    Float64Array.from(removed, (v, i) => (grid.measures[i] > 0 ? v / grid.measures[i] : 0))
  );
  putChannel(
    grid,
    "deposition",
    "metre",
    Float64Array.from(retained, (v, i) => (grid.measures[i] > 0 ? v / grid.measures[i] : 0))
  );
  context.recordCause({
    kind: "material",
    process: "physical.erosion",
    eroded,
    deposited,
    exported,
    unit: "cubic-metre",
  });
}
