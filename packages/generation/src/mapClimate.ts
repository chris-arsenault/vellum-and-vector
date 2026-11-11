import { mapCommand, mapElapsed } from "./processTraits";
import {
  everySample,
  neighbors,
  putChannel,
  requireThat,
  MapScale,
  type Grid,
  type ParameterDefinitions,
} from "@atlas/domain";
import { integratedDepth, requireChannel, summarizeChannel, surfaceArray } from "./mapFields";
import type { MapProcess } from "./process";

const temperatureParameters: ParameterDefinitions = {
  temperature: { type: "number", unit: "celsius", required: false, default: 15 },
  temperatureOffset: { type: "number", unit: "celsius", required: false, default: 0 },
  seaLevel: { type: "number", unit: "map-span", required: false, default: 0 },
  lapseRate: {
    type: "number",
    unit: "celsius/map-span",
    required: false,
    default: 26000,
    minimum: 0,
  },
};

export const temperatureProcess: MapProcess = {
  contract: {
    id: "climate.temperature",
    version: "1",
    parameters: temperatureParameters,
    requires: ["Elevation", "Heat"],
    produces: ["Temperature", "NaturalTemperature"],
    invalidates: [
      "ColumnPrecipitation",
      "Snowfall",
      "Rainfall",
      "AtmosphericWaterRate",
      "drainage",
      "Runoff",
      "FlowAccumulation",
      "lakes",
      "IceThickness",
    ],
  },
  operation: mapCommand(
    "climate.temperature",
    "event",
    (state, context) => {
      const grid = state.surface,
        scale = MapScale.fromCells(grid.bounds, grid.active.length),
        elevation = requireChannel(grid, "Elevation", "native-length"),
        heat = requireChannel(grid, "Heat", "celsius"),
        temperature = surfaceArray(state, "temperature"),
        natural = surfaceArray(state, "natural-temperature");
      for (let i = 0; i < elevation.length; i++) {
        natural.set(
          i,
          10 *
            (30 +
              Number(context.parameters.temperature) +
              Number(context.parameters.temperatureOffset) -
              Math.max(
                0,
                MapScale.metres(elevation.get(i), "native") -
                  scale.length(Number(context.parameters.seaLevel))
              ) *
                scale.inverseLength(Number(context.parameters.lapseRate)))
        );
        temperature.set(i, natural.get(i) + 10 * heat.get(i));
      }
      putChannel(grid, "NaturalTemperature", "native-temperature", natural);
      putChannel(grid, "Temperature", "native-temperature", temperature);
      context.recordCause({
        kind: "climate",
        process: "climate.temperature",
        fields: {
          naturalTemperature: summarizeChannel(grid, "NaturalTemperature"),
          temperature: summarizeChannel(grid, "Temperature"),
        },
      });
    },
    []
  ),
  validate(state) {
    requireChannel(state.surface, "Temperature", "native-temperature");
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
      seaLevel: { type: "number", unit: "map-span", required: false, default: 0 },
      incomingMoisture: {
        type: "number",
        unit: "map-span/year",
        required: false,
        default: 0.00000025,
        minimum: 0,
      },
      evaporation: {
        type: "number",
        unit: "map-span/year",
        required: false,
        default: 0.00000025,
        minimum: 0,
      },
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
        unit: "1/map-span",
        required: false,
        default: 2000,
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
    requires: ["Elevation", "Temperature"],
    produces: ["ColumnPrecipitation", "Snowfall", "Rainfall", "AtmosphericWaterRate"],
    invalidates: ["drainage", "Runoff", "FlowAccumulation", "lakes", "IceThickness"],
  },
  operation: mapCommand(
    "climate.precipitation",
    "event",
    (state, context) => {
      const grid = state.surface,
        scale = MapScale.fromCells(grid.bounds, grid.active.length),
        elevation = requireChannel(grid, "Elevation", "native-length"),
        temperature = requireChannel(grid, "Temperature", "native-temperature"),
        precipitation = surfaceArray(state, "precipitation"),
        snowfall = surfaceArray(state, "snowfall"),
        rainfall = surfaceArray(state, "rainfall"),
        moisture = surfaceArray(state, "moisture");
      for (const path of airPaths(grid, String(context.parameters.wind))) {
        let previous = -1;
        for (const i of path) {
          const connected = previous >= 0 && neighbors(grid, i).includes(previous),
            incoming = connected
              ? moisture.get(previous)
              : MapScale.inUnits(scale.length(Number(context.parameters.incomingMoisture)), "mm"),
            ocean =
              elevation.get(i) <=
              MapScale.inUnits(scale.length(Number(context.parameters.seaLevel)), "native"),
            evaporation = ocean
              ? MapScale.inUnits(scale.length(Number(context.parameters.evaporation)), "mm") *
                Math.max(0, Math.min(2, (temperature.get(i) - 100) / 400))
              : 0,
            lift = connected
              ? Math.max(0, MapScale.metres(elevation.get(i) - elevation.get(previous), "native"))
              : 0,
            fraction = Math.min(
              1,
              Number(context.parameters.condensation) +
                lift * scale.inverseLength(Number(context.parameters.orographicCondensation))
            ),
            available = incoming + evaporation,
            snowFraction = Math.max(
              0,
              Math.min(
                1,
                (Number(context.parameters.snowTemperature) +
                  Number(context.parameters.snowTransition) / 2 -
                  (temperature.get(i) / 10 - 30)) /
                  Number(context.parameters.snowTransition)
              )
            );
          precipitation.set(i, available * fraction);
          moisture.set(i, available - precipitation.get(i));
          snowfall.set(i, precipitation.get(i) * snowFraction);
          rainfall.set(i, precipitation.get(i) - snowfall.get(i));
          previous = i;
        }
      }
      for (const [name, values] of [
        ["ColumnPrecipitation", precipitation],
        ["Snowfall", snowfall],
        ["Rainfall", rainfall],
        ["AtmosphericWaterRate", moisture],
      ] as const)
        putChannel(grid, name, "millimetre/year", values);
      context.recordCause({
        kind: "climate",
        process: "climate.precipitation",
        fields: {
          precipitation: summarizeChannel(grid, "ColumnPrecipitation"),
          snowfall: summarizeChannel(grid, "Snowfall"),
        },
      });
    },
    []
  ),
  validate(state) {
    for (const name of [
      "ColumnPrecipitation",
      "Snowfall",
      "Rainfall",
      "AtmosphericWaterRate",
    ] as const)
      requireThat(
        everySample(requireChannel(state.surface, name, "millimetre/year"), (value) => value >= 0),
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
        unit: "map-span/celsius/year",
        required: false,
        default: 0.000000025,
        minimum: 0,
      },
    },
    requires: ["Temperature", "Snowfall"],
    produces: ["IceThickness", "MaximumIceThickness", "IceMeltDepth"],
    invalidates: ["drainage", "Runoff", "FlowAccumulation", "lakes"],
  },
  operation: mapElapsed(
    "ice.balance",
    { kind: "epoch", fraction: 1 },
    (state, context, years) => {
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
        scale = MapScale.fromCells(grid.bounds, grid.active.length),
        temperature = requireChannel(grid, "Temperature", "native-temperature"),
        snowfall = requireChannel(grid, "Snowfall", "millimetre/year"),
        ice = grid.channels.IceThickness
          ? requireChannel(grid, "IceThickness", "metre")
          : surfaceArray(state, "ice"),
        maximum = grid.channels.MaximumIceThickness
          ? requireChannel(grid, "MaximumIceThickness", "metre")
          : surfaceArray(state, "maximum-ice"),
        meltwater = surfaceArray(state, "meltwater"),
        accumulation = surfaceArray(state, "accumulation");
      requireThat(
        everySample(snowfall, (value) => value >= 0) && everySample(ice, (value) => value >= 0),
        "ice_input",
        "Snowfall and inherited ice remain nonnegative."
      );
      for (let i = 0; i < ice.length; i++) {
        maximum.set(i, Math.max(maximum.get(i), ice.get(i)));
        accumulation.set(i, MapScale.metres(snowfall.get(i), "mm") * years);
        meltwater.set(
          i,
          Math.min(
            ice.get(i) + accumulation.get(i),
            Math.max(0, temperature.get(i) / 10 - 30) *
              scale.length(Number(context.parameters.meltFactor)) *
              years
          )
        );
        ice.set(i, Math.max(0, ice.get(i) + accumulation.get(i) - meltwater.get(i)));
        maximum.set(i, Math.max(maximum.get(i), ice.get(i)));
      }
      putChannel(grid, "IceThickness", "metre", ice);
      putChannel(grid, "MaximumIceThickness", "metre", maximum);
      putChannel(grid, "IceMeltDepth", "metre", meltwater);
      context.recordCause({
        kind: "ice",
        process: "ice.balance",
        accumulation: integratedDepth(grid, accumulation),
        meltwater: integratedDepth(grid, meltwater),
        remaining: integratedDepth(grid, ice),
        unit: "cubic-metre",
      });
    },
    []
  ),
  validate(state) {
    for (const name of ["IceThickness", "MaximumIceThickness", "IceMeltDepth"] as const)
      requireThat(
        everySample(requireChannel(state.surface, name, "metre"), (value) => value >= 0),
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
    requires: ["Elevation"],
    produces: ["Heat"],
    invalidates: [
      "Temperature",
      "ColumnPrecipitation",
      "Snowfall",
      "Rainfall",
      "AtmosphericWaterRate",
      "Runoff",
      "drainage",
      "FlowAccumulation",
      "lakes",
      "IceThickness",
      "IceMeltDepth",
    ],
  },
  operation: mapCommand(
    "climate.resetForcing",
    "initialize",
    (state) => {
      putChannel(state.surface, "Heat", "celsius", surfaceArray(state, "heat"));
      if (state.surface.channels.IceMeltDepth) state.surface.channels.IceMeltDepth.fill(0);
    },
    []
  ),
  validate() {
    return [];
  },
};
