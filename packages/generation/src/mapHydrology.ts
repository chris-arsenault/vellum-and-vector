import {
  everySample,
  fillBand,
  foldSamples,
  putChannel,
  requireThat,
  type Band,
  type Grid,
} from "@atlas/domain";
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
    if (!grid.active.get(i)) continue;
    const target = targets.get(i);
    requireThat(
      filled.get(i) >= floor.get(i) && flow.get(i) >= 0,
      "invalid_drainage",
      "Drainage retains the floor and nonnegative discharge."
    );
    requireThat(
      target === -1 ||
        (Number.isInteger(target) &&
          grid.active.get(target) === 1 &&
          rank.get(target) < rank.get(i) &&
          filled.get(target) <= filled.get(i)),
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
      const values = (name: string) =>
        grid.coverage.scratch("float64", `erosion:${name}`, grid.active.length);
      const moving = values("moving"),
        eroded = values("eroded"),
        deposited = values("deposited");
      const count = grid.active.length;
      let exported = 0,
        n = 0;
      for (const i of grid.coverage.order(grid.channels.drainageRank, true)) {
        checkProgress(context, n++, count, "Eroding material and depositing downstream sediment");
        const target = grid.channels.receiver.get(i);
        if (!grid.active.get(i)) continue;
        const supply = removeMaterial(grid, i, target, mobile.get(i) === 1, years, context);
        eroded.set(i, supply);
        const load = moving.get(i) + supply;
        const retained = depositMaterial(
          grid,
          i,
          target,
          load,
          mobile.get(i) === 1,
          years,
          context
        );
        deposited.set(i, retained);
        if (target >= 0) moving.add(target, load - retained);
        else exported += load - retained;
      }
      recordTransport(grid, eroded, deposited, exported, context);
    },
  },
  validate(state) {
    requireChannel(state.surface, "bedrock", "metre");
    const sediment = requireChannel(state.surface, "sediment", "metre");
    requireThat(
      everySample(sediment, (v) => v >= 0),
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
  if (!movable || target < 0 || grid.measures.get(i) <= 0) return 0;
  const elevation = grid.channels.elevation,
    bedrock = grid.channels.bedrock,
    sediment = grid.channels.sediment;
  const rock = grid.channels.rock,
    flow = grid.channels.flow.get(i);
  const fall = Math.max(0, elevation.get(i) - elevation.get(target));
  const slope = fall / Math.max(1, cellDistance(grid, i, target));
  const depth = Math.min(
    fall * 0.35,
    (Number(context.parameters.erodibility) *
      Math.sqrt(flow) *
      slope *
      years *
      (1 + (grid.channels.coastalPressure?.get(i) ?? 0) / 1000)) /
      Math.max(0.1, rock.get(i))
  );
  const loose = Math.min(sediment.get(i), depth);
  sediment.add(i, -loose);
  bedrock.add(i, -(depth - loose));
  elevation.add(i, -depth);
  return depth * grid.measures.get(i);
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
  if (!movable || load <= 0 || grid.measures.get(i) <= 0) return 0;
  const elevation = grid.channels.elevation;
  const slope =
    target < 0
      ? 0
      : Math.max(0, elevation.get(i) - elevation.get(target)) /
        Math.max(1, cellDistance(grid, i, target));
  const concentration = Number(context.parameters.transportConcentration);
  const capacity =
    grid.channels.flow.get(i) * secondsPerYear * years * concentration * Math.sqrt(slope);
  const fraction =
    grid.channels.water.get(i) > 0 ? 1 : Number(context.parameters.depositionFraction);
  const volume = Math.max(0, load - capacity) * fraction;
  grid.channels.sediment.add(i, volume / grid.measures.get(i));
  elevation.add(i, volume / grid.measures.get(i));
  return volume;
}
function recordTransport(
  grid: Grid,
  removed: Band,
  retained: Band,
  exported: number,
  context: MapProcessContext
) {
  const eroded = foldSamples(removed, (sum, v) => sum + v, 0),
    deposited = foldSamples(retained, (sum, v) => sum + v, 0);
  requireThat(
    Math.abs(eroded - deposited - exported) <= Math.max(1e-7, eroded * 1e-10),
    "sediment_balance",
    "Every eroded cubic metre must be deposited or exported."
  );
  putChannel(
    grid,
    "erosion",
    "metre",
    fillBand(grid.coverage.scratch("float64", "erosion:depth", removed.length), (i) =>
      grid.measures.get(i) > 0 ? removed.get(i) / grid.measures.get(i) : 0
    )
  );
  putChannel(
    grid,
    "deposition",
    "metre",
    fillBand(grid.coverage.scratch("float64", "deposition:depth", retained.length), (i) =>
      grid.measures.get(i) > 0 ? retained.get(i) / grid.measures.get(i) : 0
    )
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
