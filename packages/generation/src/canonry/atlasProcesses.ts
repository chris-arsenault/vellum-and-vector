import { requireThat } from "@atlas/domain";
import type { GenerationState, MapProcess, MapProcessContext } from "../process";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import { nativeContracts, applyNativeStep } from "./contracts";
import { physicalContext } from "./context";
import { atlasEpoch, atlasQuality } from "./atlasProfile";
import {
  composeNativeAuthoring,
  createAtlasWorkspace,
  sampleSurfaceAtNative,
  type AtlasPhysicalWorkspace,
} from "./atlasWorkspace";
import { projectNative } from "./atlasProjection";
import { extractNativeGeography } from "./atlasFeatures";
import { physicalSchedule } from "./schedule";
import { crustalSupport } from "./support";
import { reconcileWater } from "./field";
import { clamp, rockResistance, round } from "./math";
import type { NativeStep } from "./sequence";
import { atlasSeaIce } from "./atlasSeaIce";
import { advectAtlasMagic } from "./atlasMagic";

const prefix = (fact: string) => `canonry:${fact}`;
const contract = (id: string, requires: string[] = [], produces: string[] = []) => ({
  id,
  version: "0f62584c",
  parameters: {},
  requires,
  produces,
  invalidates: [],
  workspaceOnly: true,
});
export function nativeContext(
  state: GenerationState,
  context: MapProcessContext,
  seed: number,
  salt: number
) {
  const index = context.epochIndices[0],
    epoch = index === undefined ? null : atlasEpoch(state.domain.world.epochs[index]);
  const nativeIndex = index ?? (state.physical!.map.CrustSupportInitialized ? -1 : 0);
  return physicalContext(
    seed,
    salt,
    state.physical!.profile,
    epoch,
    nativeIndex,
    state.domain.world.epochs.length
  );
}
function validateWorkspace(state: GenerationState) {
  requireThat(state.physical, "physical_workspace", "Initialize the physical mesh first.");
  return [];
}
function restoreAuthoring(work: AtlasPhysicalWorkspace) {
  composeNativeAuthoring(work);
  for (const { binding, values } of work.fixed) {
    if (binding.native !== "Elevation") continue;
    for (let i = 0; i < values.length; i++)
      if (Number.isFinite(values[i])) reconcileWater(work.map, i);
  }
}
function nativeProcess(step: NativeStep, seed: number): MapProcess {
  const [name] = step,
    source = nativeContracts[name];
  return {
    contract: {
      ...contract(
        `canonry.${name}`,
        ["canonry:workspace", ...source.requires.map(prefix)],
        source.produces.map(prefix)
      ),
      invalidates: source.invalidates.map(prefix),
      parameters: {
        iceLoad: { type: "boolean", unit: null, required: false, default: false },
        initial: { type: "boolean", unit: null, required: false, default: false },
        unforced: { type: "boolean", unit: null, required: false, default: false },
      },
    },
    apply(state, context) {
      const work = state.physical!,
        map = work.map;
      const c = nativeContext(state, context, seed, source.salt);
      if (context.parameters.initial) {
        c.EpochIndex = 0;
        c.Seed = seed ^ source.salt ^ 0x45d9f3b;
      }
      restoreAuthoring(work);
      if (name === "temperature" && context.parameters.unforced) map.ExternalHeatForcing.fill(0);
      let selected: NativeStep =
        context.parameters.iceLoad && name === "crustal-support"
          ? [name, source.salt, (map, c) => crustalSupport(map, c, true)]
          : step;
      if (name === "sea-ice") selected = [name, source.salt, atlasSeaIce];
      applyNativeStep(map, c, selected);
      restoreAuthoring(work);
      if (name === "physical-epoch-history")
        context.recordCause({
          kind: "domain",
          process: `canonry.${name}`,
          subjects: [],
          description: `Epoch ${c.EpochIndex + 1}: advected crust, geological construction, river and glacier erosion, sediment transport and coastal evolution retained their material histories.`,
        });
    },
    validate: validateWorkspace,
  };
}
export function atlasNativeProcesses(input: AtlasGenerationInput): MapProcess[] {
  const steps = physicalSchedule([
    atlasEpoch({
      id: "epoch",
      tectonics: 1,
      hydrology: 1,
      ice: 1,
      coasts: 1,
      temperature: 15,
      seaLevel: 0,
    }),
  ]);
  const implementations = new Map<string, NativeStep>();
  for (const { step } of steps)
    if (!implementations.has(step[0])) implementations.set(step[0], step);
  return [
    initializeProcess(input),
    projectProcess(input),
    forcingProcess(),
    epochStartProcess(),
    finishProcess(),
    advectAtlasMagic,
    ...Array.from(implementations.values(), (step) => nativeProcess(step, input.seed)),
  ];
}
function initializeProcess(input: AtlasGenerationInput): MapProcess {
  return {
    contract: contract("canonry.initialize", [], ["canonry:workspace"]),
    apply(state) {
      requireThat(
        input.quality in atlasQuality,
        "generation_quality",
        "Choose draft, standard or fine."
      );
      state.physical = createAtlasWorkspace(
        state,
        input.quality as keyof typeof atlasQuality,
        input.parameters
      );
      for (const fact of state.physical.map.AvailableFacts) state.facts.add(prefix(fact));
    },
    validate: validateWorkspace,
  };
}
function projectProcess(input: AtlasGenerationInput): MapProcess {
  return {
    contract: {
      ...contract(
        "canonry.project",
        ["canonry:workspace"],
        ["elevation", "geology", "fracture", "drainage", "flow"]
      ),
      workspaceOnly: false,
      parameters: { forcingOnly: { type: "boolean", unit: null, required: false, default: false } },
    },
    apply(state, context) {
      projectNative(
        state,
        Boolean(context.parameters.forcingOnly),
        !input.domains.includes("physical")
      );
    },
    validate: validateWorkspace,
  };
}
function forcingProcess(): MapProcess {
  return {
    contract: contract("canonry.forcing", ["canonry:workspace"]),
    apply(state) {
      const map = state.physical!.map;
      for (let i = 0; i < map.mesh.count; i++) {
        map.ExternalHeatForcing[i] = state.surface.channels.heat
          ? round(sampleSurfaceAtNative(state, "heat", i) * 10)
          : 0;
        if (state.surface.channels.rock)
          map.RockResistance[i] = rockResistance(
            round(sampleSurfaceAtNative(state, "rock", i) * 4000)
          );
        let pressure = 0;
        if (state.surface.channels.coastalPressure)
          for (let edge = 0; edge < 3; edge++) {
            const j = map.mesh.neighbors[i * 3 + edge];
            if (j >= 0 && map.WaterKindCodes[j] === 1)
              pressure = Math.max(pressure, sampleSurfaceAtNative(state, "coastalPressure", j));
          }
        map.ExternalCoastalForcing[i] =
          map.WaterKindCodes[i] === 0 ? round(clamp(pressure, 0, 1000)) : 0;
      }
    },
    validate: validateWorkspace,
  };
}
function epochStartProcess(): MapProcess {
  return {
    contract: contract("canonry.begin-epoch", ["canonry:workspace"]),
    apply(state) {
      const map = state.physical!.map;
      map.ExternalHeatForcing.fill(0);
      map.ExternalCoastalForcing.fill(0);
      map.GlacialMeltwater.fill(0);
    },
    validate: validateWorkspace,
  };
}
function finishProcess(): MapProcess {
  return {
    contract: {
      ...contract("canonry.features", ["canonry:Validated"], ["geographicFeatures"]),
      workspaceOnly: false,
    },
    apply: extractNativeGeography,
    validate: validateWorkspace,
  };
}
