import { requireThat, type DomainSnapshot } from "@atlas/domain";
import type { GenerationState, MapProcess } from "../process";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import { applyNativeStep } from "./contracts";
import { nativeContext } from "./context";
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
import { magicProcesses } from "./magicProcesses";
import { advectMagic } from "./magicState";
import { retainGeographicIdentities } from "./geographicIdentity";
import { refreshGrounding } from "./glacierSurface";
import { refineGeologicalCauses, refineWorkspace } from "./adaptiveWorkspace";
import { adaptiveWaterProcess } from "./adaptiveWater";
import { adaptiveClimateProcess, adaptiveIceProcess, shoreSupport } from "./adaptiveClimate";
import { prepareAdaptiveFractures } from "./adaptiveFractures";
import { ecologyProcesses } from "./ecologyProcesses";
import { selectedNativeContract, processEnabled, type ProcessSelection } from "../processSelection";
import { ecologyBindings } from "./ecologyState";
import { absentInheritedHistories, inheritedChannelNames } from "./inheritedFacts";

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
  refreshGrounding(work.map, work.profile);
}
function prepareSpatialStep(
  state: GenerationState,
  c: ReturnType<typeof nativeContext>,
  step: NativeStep
) {
  if (!state.physical!.map.mesh.topology) return step;
  const [name, salt] = step;
  refineGeologicalCauses(state, c, name);
  if (name === "coastal-detail") refineWorkspace(state, shoreSupport(state, c));
  return name === "fracture-network"
    ? ([name, salt, prepareAdaptiveFractures(state, c)] as const)
    : step;
}
function nativeProcess(
  step: NativeStep,
  seed: number,
  selection: ProcessSelection,
  inheritedAbsences: string[]
): MapProcess {
  const [name] = step,
    source = selectedNativeContract(name, selection, inheritedAbsences);
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
      const work = state.physical!;
      const c = nativeContext(state, context, seed, source.salt);
      if (context.parameters.initial) {
        c.EpochIndex = 0;
        c.Seed = seed ^ source.salt ^ 0x45d9f3b;
      }
      const spatialStep = prepareSpatialStep(state, c, step);
      const map = work.map;
      restoreAuthoring(work);
      if (name === "temperature" && context.parameters.unforced) map.ExternalHeatForcing.fill(0);
      let selected: NativeStep =
        context.parameters.iceLoad && name === "crustal-support"
          ? [name, source.salt, (map, c) => crustalSupport(map, c, true)]
          : spatialStep;
      if (name === "sea-ice") selected = [name, source.salt, atlasSeaIce];
      applyNativeStep(map, c, selected, source);
      if (name === "plate-advection") advectMagic(state);
      restoreAuthoring(work);
      if (name === "physical-epoch-history")
        context.recordCause({
          kind: "domain",
          process: `canonry.${name}`,
          subjects: [],
          description: `Epoch ${c.EpochIndex + 1}: the selected geological, river, ice and coastal processes retained their material histories. Omitted processes added no new events.`,
        });
    },
    validate: validateWorkspace,
  };
}
export function atlasNativeProcesses(
  input: AtlasGenerationInput,
  original: DomainSnapshot
): MapProcess[] {
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
  const channels = inheritedChannelNames(
    original,
    input.areaId,
    input.domains.includes("physical")
  );
  const inheritedAbsences = channels.has("elevation") ? absentInheritedHistories(channels) : [];
  return [
    initializeProcess(input),
    projectProcess(input),
    forcingProcess(),
    epochStartProcess(),
    finishProcess(original),
    advectAtlasMagic,
    ...(original.world.areas[input.areaId].profile === "world"
      ? []
      : [
          adaptiveWaterProcess(input.seed),
          adaptiveClimateProcess(input.seed),
          adaptiveIceProcess(input.seed),
        ]),
    ...magicProcesses(input.seed, input.domains.includes("magic")),
    ...ecologyProcesses(input),
    ...Array.from(implementations.values(), (step) =>
      nativeProcess(step, input.seed, input.processes ?? {}, inheritedAbsences)
    ),
  ];
}
function initializeProcess(input: AtlasGenerationInput): MapProcess {
  return {
    contract: contract("canonry.initialize", [], ["canonry:workspace", "canonry:SedimentSupply"]),
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
      state.physical.map.AvailableFacts.add("SedimentSupply");
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
      omitUnselectedChannels(state, input);
    },
    validate: validateWorkspace,
  };
}
function omitUnselectedChannels(state: GenerationState, input: AtlasGenerationInput) {
  const selection = input.processes ?? {};
  const channels = [
    ...(!processEnabled(selection, "atlas.ecology-evolve")
      ? ecologyBindings.map(([name]) => name)
      : []),
    ...(!processEnabled(selection, "canonry.river-floodplains") ? ["floodplain"] : []),
    ...(!processEnabled(selection, "canonry.river-delta-formation") ? ["delta"] : []),
  ];
  for (const channel of channels) {
    delete state.surface.channels[channel];
    delete state.surface.units[channel];
  }
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
        map.ExternalHeatForcing[i] += state.physical!.magic?.heat[i] ?? 0;
        if (state.surface.channels.rock)
          map.RockResistance[i] = rockResistance(
            round(sampleSurfaceAtNative(state, "rock", i) * 4000)
          );
        const pressure = sampleCoastalPressure(state, i);
        map.ExternalCoastalForcing[i] =
          map.WaterKindCodes[i] === 0 ? round(clamp(pressure, 0, 1000)) : 0;
      }
    },
    validate: validateWorkspace,
  };
}
function sampleCoastalPressure(state: GenerationState, i: number) {
  if (!state.surface.channels.coastalPressure) return 0;
  const map = state.physical!.map;
  let pressure = 0;
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const j = map.mesh.neighbors[i * map.mesh.stride + edge];
    if (j >= 0 && map.WaterKindCodes[j] === 1)
      pressure = Math.max(pressure, sampleSurfaceAtNative(state, "coastalPressure", j));
  }
  return pressure;
}
function epochStartProcess(): MapProcess {
  return {
    contract: contract("canonry.begin-epoch", ["canonry:workspace"]),
    apply(state) {
      const map = state.physical!.map;
      map.ExternalHeatForcing.fill(0);
      map.ExternalCoastalForcing.fill(0);
      map.GlacialMeltwater.fill(0);
      state.physical!.magic?.heat.fill(0);
      state.physical!.magic?.coastal.fill(0);
    },
    validate: validateWorkspace,
  };
}
function finishProcess(original: DomainSnapshot): MapProcess {
  return {
    contract: {
      ...contract("canonry.features", ["canonry:Validated"], ["geographicFeatures"]),
      workspaceOnly: false,
    },
    apply(state, context) {
      const before = new Map(Object.entries(state.domain.world.features));
      extractNativeGeography(state, context);
      const generated = new Set(
        Object.values(state.domain.world.features)
          .filter((feature) => before.get(feature.id) !== feature)
          .map((feature) => feature.id)
      );
      retainGeographicIdentities(state, original, state.physical!.map.mesh.spacing * 2, generated);
    },
    validate: validateWorkspace,
  };
}
