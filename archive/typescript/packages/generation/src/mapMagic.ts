import { mapCommand, mapElapsed } from "./processTraits";
import {
  gridPosition,
  point,
  putChannel,
  spatial,
  requireThat,
  MapScale,
  type ParameterDefinitions,
  type World,
} from "@atlas/domain";
import { requireChannel, summarizeChannel, surfaceArray, surfaceValues } from "./mapFields";
import type { GenerationState, MapProcess, MapProcessContext } from "./process";
import { generationBindings, physicalEpochIndex } from "./generationBindings";

const activityParameters: ParameterDefinitions = {
  sourceActivity: { type: "number", unit: "ratio", required: false, default: 1, minimum: 0 },
  heatActivity: { type: "number", unit: "ratio", required: false, default: 1, minimum: 0 },
  coldActivity: { type: "number", unit: "ratio", required: false, default: 1, minimum: 0 },
};
const invalidatedClimate = [
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
];
type Source = World["magic"][number];

function sources(state: GenerationState, context: MapProcessContext): Source[] {
  return state.domain.world.magic.filter(
    (source) =>
      !source.systemId &&
      ["heat", "cold"].includes(source.effect) &&
      (!source.spaceId || source.spaceId === context.scope.spaceId)
  );
}

function activity(context: MapProcessContext, source: Source): number {
  // Magical starts refer to the physical timeline. Nested occupation/cave
  // episodes do not advance it; a child can explicitly map to its parent epoch.
  const epochs = context.inputs?.features ? generationBindings(context).settings.epochs : [];
  const index = Math.max(0, physicalEpochIndex(epochs, context.epochs));
  return index >= source.startsAtEpoch
    ? Number(context.parameters.sourceActivity) *
        Number(context.parameters[source.effect === "cold" ? "coldActivity" : "heatActivity"])
    : 0;
}

function forcingAt(
  state: GenerationState,
  source: Source,
  multiplier: number,
  i: number,
  scale: MapScale
): number {
  const position = gridPosition(state.surface, i),
    covered = !source.scope || spatial.covers(source.scope, point(position)),
    distance = Math.hypot(position.x - source.source.x, position.y - source.source.y),
    forcing = covered
      ? source.strength *
        Math.max(0, 1 - distance / source.radius) *
        multiplier *
        propagationWeight(state, source, i, scale)
      : 0;
  return source.effect === "cold" ? -forcing : forcing;
}
function propagationWeight(state: GenerationState, source: Source, i: number, scale: MapScale) {
  const grid = state.surface;
  switch (source.propagation) {
    case "fracture":
      return 0.1 + 0.0009 * (grid.channels.FractureConductance?.get(i) ?? 0);
    case "cold":
      return coldWeight(state, i, scale);
    case "ocean":
      return oceanWeight(state, i);
    default:
      return 1;
  }
}
function oceanWeight(state: GenerationState, i: number) {
  const c = state.surface.channels;
  return (c.Elevation?.get(i) ?? 0) < (c.EffectiveSeaLevel?.get(i) ?? 0) ? 1 : 0;
}
function coldWeight(state: GenerationState, i: number, scale: MapScale) {
  const channels = state.surface.channels;
  const temperature =
    channels.Temperature?.get(i) ??
    450 -
      10 * MapScale.metres(channels.Elevation?.get(i) ?? 0, "native") * scale.inverseLength(26000);
  return Math.max(0, Math.min(1, (20 - (temperature / 10 - 30)) / 30));
}
export function magicalForcing(
  state: GenerationState,
  context: MapProcessContext,
  source: Source,
  i: number
) {
  return forcingAt(
    state,
    source,
    activity(context, source),
    i,
    MapScale.fromCells(state.surface.bounds, state.surface.active.length)
  );
}

// Re-evaluation replaces instantaneous forcing; it never advances stored history.
export const thermalMagicProcess: MapProcess = {
  contract: {
    id: "magic.thermal",
    version: "1",
    parameters: activityParameters,
    requires: ["Elevation"],
    produces: ["Heat", "StoredHeat"],
    invalidates: invalidatedClimate,
  },
  operation: mapCommand(
    "magic.thermal",
    "event",
    (state, context) => {
      const grid = state.surface,
        scale = MapScale.fromCells(grid.bounds, grid.active.length),
        heat = surfaceArray(state, "magic:heat"),
        stored = surfaceArray(state, "magic:stored");
      for (const source of sources(state, context)) {
        const multiplier = activity(context, source),
          key = `magic:${source.id}:stored` as const,
          memory = grid.channels[key]
            ? requireChannel(grid, key, "celsius")
            : surfaceArray(state, key),
          forcing = surfaceValues(state, "magic:forcing", (i) =>
            forcingAt(state, source, multiplier, i, scale)
          ),
          forcingKey = `magic:${source.id}:forcing` as const;
        for (let i = 0; i < heat.length; i++) {
          heat.add(i, forcing.get(i) + memory.get(i));
          stored.add(i, memory.get(i));
        }
        putChannel(grid, forcingKey, "celsius", forcing);
        putChannel(grid, key, "celsius", memory);
        putChannel(
          grid,
          `magic:${source.id}`,
          "celsius",
          surfaceValues(state, `magic:${source.id}`, (i) => forcing.get(i) + memory.get(i))
        );
        context.recordCause({
          kind: "magic",
          process: "magic.thermal",
          sourceId: source.id,
          activity: multiplier,
          forcing: summarizeChannel(grid, forcingKey),
          stored: summarizeChannel(grid, key),
        });
      }
      putChannel(grid, "Heat", "celsius", heat);
      putChannel(grid, "StoredHeat", "celsius", stored);
    },
    []
  ),
  validate(state) {
    requireChannel(state.surface, "Heat", "celsius");
    requireChannel(state.surface, "StoredHeat", "celsius");
    return [];
  },
};

// Storage is an elapsed-time process, distinct from the repeated field refresh.
// Storage loads signed forcing per year while decay is a fractional annual loss.
export const magicStorageProcess: MapProcess = {
  contract: {
    id: "magic.advanceStorage",
    version: "1",
    parameters: {},
    requires: ["Heat"],
    produces: ["magicStorage"],
    invalidates: ["Heat", ...invalidatedClimate],
  },
  operation: mapElapsed(
    "magic.advanceStorage",
    { kind: "epoch", fraction: 1 },
    (state, context, years) => {
      requireThat(
        context.epochs.length > 0,
        "magic_storage_epoch",
        "Advance magical storage in an explicit epoch."
      );
      const grid = state.surface;
      for (const source of sources(state, context)) {
        requireThat(
          !context.causes.some(
            (cause) =>
              cause.kind === "magic" &&
              cause.process === "magic.advanceStorage" &&
              cause.sourceId === source.id
          ),
          "magic_epoch_advance",
          "A source's storage advances once per epoch; thermal refresh does not advance time."
        );
        const multiplier = [...context.causes]
            .reverse()
            .find(
              (cause) =>
                cause.kind === "magic" &&
                cause.process === "magic.thermal" &&
                cause.sourceId === source.id
            ),
          key = `magic:${source.id}:stored` as const,
          memory = grid.channels[key]
            ? requireChannel(grid, key, "celsius")
            : surfaceArray(state, key),
          forcing = requireChannel(grid, `magic:${source.id}:forcing`, "celsius");
        requireThat(
          source.decay >= 0 && source.decay <= 1 && source.storage >= 0,
          "magic_storage",
          "Magic storage and annual decay have valid nonnegative values."
        );
        const retention = Math.pow(1 - source.decay, years),
          rate = -Math.log1p(-source.decay),
          loadingYears =
            years === 0 ? 0 : source.decay === 0 ? years : -Math.expm1(-rate * years) / rate;
        for (let i = 0; i < memory.length; i++)
          memory.set(i, memory.get(i) * retention + forcing.get(i) * source.storage * loadingYears);
        putChannel(grid, key, "celsius", memory);
        context.recordCause({
          kind: "magic",
          process: "magic.advanceStorage",
          sourceId: source.id,
          activity: multiplier?.kind === "magic" ? multiplier.activity : 0,
          forcing: summarizeChannel(grid, `magic:${source.id}:forcing`),
          stored: summarizeChannel(grid, key),
        });
      }
    },
    []
  ),
  validate() {
    return [];
  },
};
