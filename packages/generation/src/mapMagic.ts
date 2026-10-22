import {
  gridPosition,
  point,
  putChannel,
  replaceChannel,
  spatial,
  requireThat,
  channelValue,
  type ParameterDefinitions,
  type World,
} from "@atlas/domain";
import { requireChannel, summarizeChannel } from "./mapFields";
import type { GenerationState, MapProcess, MapProcessContext } from "./process";
import { generationBindings } from "./generationBindings";

const activityParameters: ParameterDefinitions = {
  sourceActivity: { type: "number", unit: "ratio", required: false, default: 1, minimum: 0 },
  heatActivity: { type: "number", unit: "ratio", required: false, default: 1, minimum: 0 },
  coldActivity: { type: "number", unit: "ratio", required: false, default: 1, minimum: 0 },
};
const invalidatedClimate = [
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
  const physical = context.epochs[0],
    parent = physical?.parentEpoch ?? physical?.id,
    inheritedIndex = epochs.findIndex((epoch) => epoch.id === parent),
    index =
      inheritedIndex >= 0
        ? inheritedIndex
        : (context.epochIndices[0] ?? Math.max(0, epochs.length - 1));
  return index >= source.startsAtEpoch
    ? Number(context.parameters.sourceActivity) *
        Number(context.parameters[source.effect === "cold" ? "coldActivity" : "heatActivity"])
    : 0;
}

function forcingAt(state: GenerationState, source: Source, multiplier: number, i: number): number {
  const position = gridPosition(state.surface, i),
    covered = !source.scope || spatial.covers(source.scope, point(position)),
    distance = Math.hypot(position.x - source.source.x, position.y - source.source.y),
    forcing = covered
      ? source.strength *
        Math.max(0, 1 - distance / source.radius) *
        multiplier *
        propagationWeight(state, source, i)
      : 0;
  return source.effect === "cold" ? -forcing : forcing;
}
function propagationWeight(state: GenerationState, source: Source, i: number) {
  const grid = state.surface;
  switch (source.propagation) {
    case "fracture":
      return 0.1 + 0.9 * (grid.channels.fracture ? channelValue(grid, "fracture", i) : 0);
    case "cold":
      return Math.max(
        0,
        Math.min(
          1,
          (20 -
            (grid.channels.temperature
              ? channelValue(grid, "temperature", i)
              : 15 - channelValue(grid, "elevation", i) * 0.0065)) /
            30
        )
      );
    case "ocean":
      return channelValue(grid, "elevation", i) < 0 ? 1 : 0;
    default:
      return 1;
  }
}
export function magicalForcing(
  state: GenerationState,
  context: MapProcessContext,
  source: Source,
  i: number
) {
  return forcingAt(state, source, activity(context, source), i);
}

// Re-evaluation replaces instantaneous forcing; it never advances stored history.
export const thermalMagicProcess: MapProcess = {
  contract: {
    id: "magic.thermal",
    version: "1",
    parameters: activityParameters,
    requires: ["elevation"],
    produces: ["heat"],
    invalidates: invalidatedClimate,
  },
  behavior: {
    kind: "forcing-contributor",
    contribute(state, context) {
      const grid = state.surface,
        heat = new Float64Array(grid.active.length),
        stored = new Float64Array(grid.active.length);
      for (const source of sources(state, context)) {
        const multiplier = activity(context, source),
          key = `magic:${source.id}:stored`,
          memory = grid.channels[key]
            ? requireChannel(grid, key, "celsius")
            : new Float64Array(heat.length),
          forcing = Float64Array.from(heat, (_value, i) => forcingAt(state, source, multiplier, i)),
          forcingKey = `magic:${source.id}:forcing`;
        for (let i = 0; i < heat.length; i++) {
          heat[i] += forcing[i] + memory[i];
          stored[i] += memory[i];
        }
        replaceChannel(grid, forcingKey, "celsius", forcing);
        putChannel(grid, key, "celsius", memory);
        replaceChannel(
          grid,
          `magic:${source.id}`,
          "celsius",
          Float64Array.from(forcing, (value, i) => value + memory[i])
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
      replaceChannel(grid, "heat", "celsius", heat);
      replaceChannel(grid, "storedHeat", "celsius", stored);
    },
  },
  validate(state) {
    requireChannel(state.surface, "heat", "celsius");
    requireChannel(state.surface, "storedHeat", "celsius");
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
    requires: ["heat"],
    produces: ["magicStorage"],
    invalidates: ["heat", ...invalidatedClimate],
  },
  behavior: {
    kind: "elapsed",
    duration: { kind: "epoch", fraction: 1 },
    advance(state, context, years) {
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
          key = `magic:${source.id}:stored`,
          memory = grid.channels[key]
            ? requireChannel(grid, key, "celsius")
            : new Float64Array(grid.active.length),
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
          memory[i] = memory[i] * retention + forcing[i] * source.storage * loadingYears;
        replaceChannel(grid, key, "celsius", memory);
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
  },
  validate() {
    return [];
  },
};
