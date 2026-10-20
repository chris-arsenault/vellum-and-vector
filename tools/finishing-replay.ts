import { mkdir, readFile, writeFile } from "node:fs/promises";
import { deserialize, serialize } from "node:v8";
import { macroLandscapeProcess } from "../packages/generation/src/canonry/macroProcess";
import { projectNative } from "../packages/generation/src/canonry/atlasProjection";
import { projectMagic } from "../packages/generation/src/canonry/magicFeatures";
import { extractNativeGeography } from "../packages/generation/src/canonry/atlasFeatures";
import type { GenerationState, MapProcessContext } from "../packages/generation/src/process";

const quality = process.argv[2] ?? "draft",
  seed = Number(process.argv[3] ?? 104729),
  source = `.artifacts/finishing-${quality}-${seed}`,
  directory = `${source}/refined`,
  state = deserialize(await readFile(`${source}/evolved-fixture.bin`)) as GenerationState,
  started = performance.now(),
  context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: ["finishing-replay"],
    parameters: {},
    epochs: [],
    epochIndices: [],
    causes: [],
    recordCause(cause) {
      (state.causes ??= []).push(cause);
    },
    random: () => 0.5,
    cancelled: () => false,
    progress(_fraction, message) {
      console.log(message, ((performance.now() - started) / 1000).toFixed(2));
    },
  };
await mkdir(directory, { recursive: true });
await macroLandscapeProcess(seed).apply(state, context);
projectNative(state);
projectMagic(state);
extractNativeGeography(state, context);
const features = Object.values(state.domain.world.features),
  grid = state.surface;
delete state.physical;
await writeFile(`${directory}/after.bin`, serialize({ grid, features, history: state.history }));
await writeFile(`${directory}/before.bin`, await readFile(`${source}/before.bin`));
console.log({
  quality,
  seconds: (performance.now() - started) / 1000,
  peakRssMiB: process.resourceUsage().maxRSS / 1024,
  features: features.length,
  directory,
});
