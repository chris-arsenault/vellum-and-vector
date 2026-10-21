import {
  neighbors,
  putChannel,
  requireThat,
  type Grid,
  type ParameterDefinitions,
} from "@atlas/domain";
import { integratedDepth, requireChannel, summarizeChannel } from "./mapFields";
import type { MapProcess } from "./process";

const temperatureParameters: ParameterDefinitions = {
  temperature: { type: "number", unit: "celsius", required: false, default: 15 },
  temperatureOffset: { type: "number", unit: "celsius", required: false, default: 0 },
  seaLevel: { type: "number", unit: "metre", required: false, default: 0 },
  lapseRate: {
    type: "number",
    unit: "celsius/metre",
    required: false,
    default: 0.0065,
    minimum: 0,
  },
};

export const temperatureProcess: MapProcess = {
  contract: {
    id: "climate.temperature",
    version: "1",
    parameters: temperatureParameters,
    requires: ["elevation", "heat"],
    produces: ["temperature"],
    invalidates: [
      "precipitation",
      "snowfall",
      "rainfall",
      "moisture",
      "drainage",
      "runoff",
      "flow",
      "lakes",
      "ice",
    ],
  },
  behavior: {
    kind: "model-pass",
    applyPass(state, context) {
      const grid = state.surface,
        elevation = requireChannel(grid, "elevation", "metre"),
        heat = requireChannel(grid, "heat", "celsius"),
        temperature = new Float64Array(elevation.length),
        natural = new Float64Array(elevation.length);
      for (let i = 0; i < elevation.length; i++) {
        natural[i] =
          Number(context.parameters.temperature) +
          Number(context.parameters.temperatureOffset) -
          Math.max(0, elevation[i] - Number(context.parameters.seaLevel)) *
            Number(context.parameters.lapseRate);
        temperature[i] = natural[i] + heat[i];
      }
      putChannel(grid, "naturalTemperature", "celsius", natural);
      putChannel(grid, "temperature", "celsius", temperature);
      context.recordCause({
        kind: "climate",
        process: "climate.temperature",
        fields: {
          naturalTemperature: summarizeChannel(grid, "naturalTemperature"),
          temperature: summarizeChannel(grid, "temperature"),
        },
      });
    },
  },
  validate(state) {
    requireChannel(state.surface, "temperature", "celsius");
    return [];
  },
};

// A steady prevailing-air path carries moisture from the inflow boundary and
// ocean evaporation. Rising terrain removes more moisture; the remaining air
// reaches the lee side depleted. These are rates, not an elapsed-time advance.
function* airPaths(grid: Grid, wind: string): Generator<number[]> {
  requireThat(
    !grid.topology,
    "prototype_grid",
    "Use the Canonry workflow for adaptive physical geography."
  );
  const horizontal = wind === "east" || wind === "west",
    positive = wind === "east" || wind === "north",
    along = horizontal ? grid.width : grid.height,
    across = horizontal ? grid.height : grid.width;
  for (let line = 0; line < across; line++)
    yield Array.from({ length: along }, (_value, step) => {
      const position = positive ? step : along - 1 - step;
      return horizontal ? line * grid.width + position : position * grid.width + line;
    });
}

export const precipitationProcess: MapProcess = {
  contract: {
    id: "climate.precipitation",
    version: "1",
    parameters: {
      wind: {
        type: "enum",
        unit: null,
        required: false,
        default: "east",
        choices: ["east", "west", "north", "south"],
      },
      seaLevel: { type: "number", unit: "metre", required: false, default: 0 },
      incomingMoisture: {
        type: "number",
        unit: "metre/year",
        required: false,
        default: 1,
        minimum: 0,
      },
      evaporation: { type: "number", unit: "metre/year", required: false, default: 1, minimum: 0 },
      condensation: {
        type: "number",
        unit: "ratio",
        required: false,
        default: 0.2,
        minimum: 0,
        maximum: 1,
      },
      orographicCondensation: {
        type: "number",
        unit: "1/metre",
        required: false,
        default: 0.0005,
        minimum: 0,
      },
      snowTemperature: { type: "number", unit: "celsius", required: false, default: 0 },
      snowTransition: {
        type: "number",
        unit: "celsius",
        required: false,
        default: 2,
        minimum: 0.001,
      },
    },
    requires: ["elevation", "temperature"],
    produces: ["precipitation", "snowfall", "rainfall", "moisture"],
    invalidates: ["drainage", "runoff", "flow", "lakes", "ice"],
  },
  behavior: {
    kind: "model-pass",
    applyPass(state, context) {
      const grid = state.surface,
        elevation = requireChannel(grid, "elevation", "metre"),
        temperature = requireChannel(grid, "temperature", "celsius"),
        precipitation = new Float64Array(elevation.length),
        snowfall = new Float64Array(elevation.length),
        rainfall = new Float64Array(elevation.length),
        moisture = new Float64Array(elevation.length);
      for (const path of airPaths(grid, String(context.parameters.wind))) {
        let previous = -1;
        for (const i of path) {
          const connected = previous >= 0 && neighbors(grid, i).includes(previous),
            incoming = connected ? moisture[previous] : Number(context.parameters.incomingMoisture),
            ocean = elevation[i] <= Number(context.parameters.seaLevel),
            evaporation = ocean
              ? Number(context.parameters.evaporation) *
                Math.max(0, Math.min(2, (temperature[i] + 20) / 40))
              : 0,
            lift = connected ? Math.max(0, elevation[i] - elevation[previous]) : 0,
            fraction = Math.min(
              1,
              Number(context.parameters.condensation) +
                lift * Number(context.parameters.orographicCondensation)
            ),
            available = incoming + evaporation,
            snowFraction = Math.max(
              0,
              Math.min(
                1,
                (Number(context.parameters.snowTemperature) +
                  Number(context.parameters.snowTransition) / 2 -
                  temperature[i]) /
                  Number(context.parameters.snowTransition)
              )
            );
          precipitation[i] = available * fraction;
          moisture[i] = available - precipitation[i];
          snowfall[i] = precipitation[i] * snowFraction;
          rainfall[i] = precipitation[i] - snowfall[i];
          previous = i;
        }
      }
      for (const [name, values] of Object.entries({ precipitation, snowfall, rainfall, moisture }))
        putChannel(grid, name, "metre/year", values);
      context.recordCause({
        kind: "climate",
        process: "climate.precipitation",
        fields: {
          precipitation: summarizeChannel(grid, "precipitation"),
          snowfall: summarizeChannel(grid, "snowfall"),
        },
      });
    },
  },
  validate(state) {
    for (const name of ["precipitation", "snowfall", "rainfall", "moisture"])
      requireThat(
        requireChannel(state.surface, name, "metre/year").every((value) => value >= 0),
        "precipitation_invalid",
        "Atmospheric water rates remain nonnegative."
      );
    return [];
  },
};

export const iceBalanceProcess: MapProcess = {
  contract: {
    id: "ice.balance",
    version: "1",
    parameters: {
      meltFactor: {
        type: "number",
        unit: "metre/celsius/year",
        required: false,
        default: 0.1,
        minimum: 0,
      },
    },
    requires: ["temperature", "snowfall"],
    produces: ["ice", "meltwater"],
    invalidates: ["drainage", "runoff", "flow", "lakes"],
  },
  behavior: {
    kind: "elapsed",
    duration: { kind: "epoch", fraction: 1 },
    advance(state, context, years) {
      requireThat(
        context.epochs.length > 0,
        "ice_epoch",
        "Advance ice in an explicit epoch; present reconciliation must not invent elapsed time."
      );
      requireThat(
        !context.causes.some((cause) => cause.kind === "ice"),
        "ice_epoch_advance",
        "Ice balance advances once per epoch; refresh climate without advancing ice again."
      );
      const grid = state.surface,
        temperature = requireChannel(grid, "temperature", "celsius"),
        snowfall = requireChannel(grid, "snowfall", "metre/year"),
        ice = grid.channels.ice
          ? requireChannel(grid, "ice", "metre")
          : new Float64Array(grid.active.length),
        maximum = grid.channels.maximumIce
          ? requireChannel(grid, "maximumIce", "metre")
          : new Float64Array(grid.active.length),
        meltwater = new Float64Array(grid.active.length),
        accumulation = new Float64Array(grid.active.length);
      requireThat(
        snowfall.every((value) => value >= 0) && ice.every((value) => value >= 0),
        "ice_input",
        "Snowfall and inherited ice remain nonnegative."
      );
      for (let i = 0; i < ice.length; i++) {
        maximum[i] = Math.max(maximum[i], ice[i]);
        accumulation[i] = snowfall[i] * years;
        meltwater[i] = Math.min(
          ice[i] + accumulation[i],
          Math.max(0, temperature[i]) * Number(context.parameters.meltFactor) * years
        );
        ice[i] = Math.max(0, ice[i] + accumulation[i] - meltwater[i]);
        maximum[i] = Math.max(maximum[i], ice[i]);
      }
      putChannel(grid, "ice", "metre", ice);
      putChannel(grid, "maximumIce", "metre", maximum);
      putChannel(grid, "meltwater", "metre", meltwater);
      context.recordCause({
        kind: "ice",
        process: "ice.balance",
        accumulation: integratedDepth(grid, accumulation),
        meltwater: integratedDepth(grid, meltwater),
        remaining: integratedDepth(grid, ice),
        unit: "cubic-metre",
      });
    },
  },
  validate(state) {
    for (const name of ["ice", "maximumIce", "meltwater"])
      requireThat(
        requireChannel(state.surface, name, "metre").every((value) => value >= 0),
        "ice_invalid",
        "Ice and meltwater depths remain nonnegative."
      );
    return [];
  },
};

export const resetForcingProcess: MapProcess = {
  contract: {
    id: "climate.resetForcing",
    version: "1",
    parameters: {},
    requires: ["elevation"],
    produces: ["heat"],
    invalidates: [
      "temperature",
      "precipitation",
      "snowfall",
      "rainfall",
      "moisture",
      "runoff",
      "drainage",
      "flow",
      "lakes",
      "ice",
      "meltwater",
    ],
  },
  behavior: {
    kind: "initialize",
    initialize(state) {
      putChannel(state.surface, "heat", "celsius", new Float64Array(state.surface.active.length));
      if (state.surface.channels.meltwater) state.surface.channels.meltwater.fill(0);
    },
  },
  validate() {
    return [];
  },
};
