import { mkdir, writeFile } from "node:fs/promises";
import { serialize } from "node:v8";
import { spatial } from "../packages/domain/src/index";
import { atlasConfiguration, initialState } from "../packages/generation/src/atlasWorkflow";
import { atlasParametersSchema } from "../packages/generation/src/atlasParameters";
import { MapProcessRegistry, type MapProcess } from "../packages/generation/src/process";
import { MapRunner } from "../packages/generation/src/mapRunner";
import { thermalMagicProcess, magicStorageProcess } from "../packages/generation/src/mapMagic";
import { materialMagicProcess } from "../packages/generation/src/mapMagicEffects";
import { culturalProcess, politicalProcess } from "../packages/generation/src/mapPeople";
import { builtProcess } from "../packages/generation/src/mapBuilt";
import { prepareGeneratedProcess } from "../packages/generation/src/mapFeatures";
import { atlasNativeProcesses } from "../packages/generation/src/canonry/atlasProcesses";
import { projectNative } from "../packages/generation/src/canonry/atlasProjection";
import { projectMagic } from "../packages/generation/src/canonry/magicFeatures";
import { oceanFootprint } from "../packages/generation/src/canonry/geographicContours";
import { createRiverPaths, riverPath } from "../packages/generation/src/canonry/riverPaths";
import { riverReaches } from "../packages/generation/src/canonry/macroRivers";
import { createWorld, session } from "../frontend/src/atlasState";

// Production configuration and processes, observed directly rather than through a browser.
const quality = process.argv[2] ?? "draft",
  seed = Number(process.argv[3] ?? 104729),
  world = createWorld({ name: "Macro finishing", seed, width: 4_000_000, height: 3_000_000 }),
  source = session(world.id).snapshot,
  input = {
    areaId: source.scope.areaId,
    seed,
    quality,
    domains: ["physical", "magic", "cultural", "political", "built"],
    parameters: atlasParametersSchema.parse({}),
  },
  directory = `.artifacts/finishing-${quality}-${seed}`;
await mkdir(directory, { recursive: true });
let finishingMs = 0;
function observe(process: MapProcess): MapProcess {
  if (process.contract.id !== "canonry.landscape-finalize") return process;
  return {
    ...process,
    async apply(state, context) {
      await writeFile(`${directory}/evolved-fixture.bin`, serialize(state));
      projectNative(state);
      projectMagic(state);
      state.surface.ocean = oceanFootprint(state);
      const map = state.physical!.map,
        paths = createRiverPaths(map),
        rivers = riverReaches(state.physical!).map(
          (cells) => riverPath(map, paths, cells).geometry
        );
      await writeFile(
        `${directory}/before.bin`,
        serialize({ grid: state.surface, rivers, features: [] })
      );
      const started = performance.now();
      await process.apply(state, context);
      finishingMs = performance.now() - started;
      console.log(
        "Finalizer",
        (finishingMs / 1000).toFixed(2),
        "seconds",
        state.physical!.finishing!.profiles.length,
        "profiles"
      );
    },
  };
}
const registry = [
    thermalMagicProcess,
    magicStorageProcess,
    materialMagicProcess,
    culturalProcess,
    politicalProcess,
    builtProcess,
    ...atlasNativeProcesses(input, source).map(observe),
    prepareGeneratedProcess(input.domains),
  ].reduce((registry, process) => registry.register(process), new MapProcessRegistry()),
  configuration = atlasConfiguration(source, input),
  started = performance.now();
let stepStarted = started;
const result = await new MapRunner(configuration, registry).run(initialState(source, input), {
  seed: String(seed),
  seedScope: JSON.stringify(["world", spatial.bounds(source.scope.footprint)]),
  progress(path, _fraction, message) {
    if (message.startsWith("Starting ")) stepStarted = performance.now();
    if (message.startsWith("Completed ") && performance.now() - stepStarted > 1000)
      console.log(message, ((performance.now() - stepStarted) / 1000).toFixed(2), "seconds");
    if (
      path.some((part) => part.startsWith("canonry.landscape-finalize")) &&
      !message.startsWith("Completed ")
    )
      console.log(message);
  },
  async saveBoundary(boundary) {
    if (boundary.kind === "epoch") console.log("Completed epoch", boundary.ancestry.at(-1)?.id);
  },
});
const features = Object.values(result.state.domain.world.features),
  totalMs = performance.now() - started;
await writeFile(
  `${directory}/after.bin`,
  serialize({
    grid: result.state.surface,
    features,
    rivers: features
      .filter((feature) => feature.kind === "river")
      .map((feature) => feature.geometry),
    history: result.state.history,
  })
);
console.log(
  JSON.stringify(
    {
      quality,
      seed,
      totalSeconds: totalMs / 1000,
      finishingSeconds: finishingMs / 1000,
      peakRssMiB: process.resourceUsage().maxRSS / 1024,
      epochs: result.state.history.length,
      features: features.reduce(
        (counts, feature) => {
          counts[feature.kind] = (counts[feature.kind] ?? 0) + 1;
          return counts;
        },
        {} as Record<string, number>
      ),
      directory,
    },
    null,
    2
  )
);
