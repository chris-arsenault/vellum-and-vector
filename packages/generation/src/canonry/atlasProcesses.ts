import { requireThat, type DomainSnapshot } from "@atlas/domain";
import type { GenerationState, MapProcess } from "../process";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import { applyNativeStep } from "./contracts";
import { nativeContext } from "./context";
import { atlasEpoch, atlasQuality } from "./atlasProfile";
import { configuredPhysicalProfile } from "../physicalProfileConfiguration";
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
import { advectMagic } from "./magicState";
import { retainGeographicIdentities } from "./geographicIdentity";
import { refreshGrounding } from "./glacierSurface";
import { refineGeologicalCauses, refineWorkspace, remeshInvalidations } from "./adaptiveWorkspace";
import { adaptiveWaterProcess } from "./adaptiveWater";
import { adaptiveClimateProcess, adaptiveIceProcess, shoreSupport } from "./adaptiveClimate";
import { prepareAdaptiveFractures } from "./adaptiveFractures";
import { nativeFeatureContract } from "../physicalFeatures";
import type { ResolvedFeatures } from "../features";
import { generationBindings } from "../generationBindings";
import { absenceInitialization } from "./absenceInitialization";
import { physicalProduct, nativeBehavior } from "./physicalProducts";
import { atlasPublicationDefinitions, selectedAtlasChannels } from "./atlasPublications";
import {
  absentInheritedHistories,
  inheritedChannelNames,
  inheritedNativeFacts,
} from "./inheritedFacts";

const prefix = (fact: string) => `canonry:${fact}`;
const nativeFlags: MapProcess["contract"]["parameters"] = {
  iceLoad: { type: "boolean", unit: null, required: false, default: false },
  initial: { type: "boolean", unit: null, required: false, default: false },
  unforced: { type: "boolean", unit: null, required: false, default: false },
};
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
  refineGeologicalCauses(state, c, name, "declared");
  if (name === "coastal-detail") refineWorkspace(state, shoreSupport(state, c), "declared");
  return name === "fracture-network"
    ? ([name, salt, prepareAdaptiveFractures(state, c, "declared")] as const)
    : step;
}
function nativeProcess(
  step: NativeStep,
  selection: ResolvedFeatures,
  inheritedAbsences: string[],
  adaptive: boolean
): MapProcess {
  const [name] = step,
    source = nativeFeatureContract(name, selection, inheritedAbsences);
  return {
    contract: {
      ...contract(
        `canonry.${name}`,
        ["canonry:workspace", ...source.requires.map(prefix)],
        [
          ...source.produces.map(prefix),
          ...(name === "land-ice-mass-balance" ? ["canonry:IceState"] : []),
          ...(["impact-cratering", "volcanic-construction", "fracture-network"].includes(name)
            ? ["canonry:FractureState"]
            : []),
        ]
      ),
      invalidates: source.invalidates.map(prefix),
      ...nativeRemeshContract(name, adaptive),
      products: [
        ...source.produces.map(physicalProduct),
        ...(name === "land-ice-mass-balance"
          ? [
              {
                id: "canonry:IceState",
                lifetime: "run" as const,
                representation: "history" as const,
                unit: "metre",
                composition: "shared-state" as const,
              },
            ]
          : []),
      ],
      inputs: source.inputs.map((input) => ({ ...input, product: prefix(input.product) })),
      parameters: nativeFlags,
    },
    behavior: nativeBehavior(name, async (state, context) => {
      const work = state.physical!;
      const c = nativeContext(state, context, source.salt);
      if (context.parameters.initial) {
        c.EpochIndex = 0;
        c.Seed = generationBindings(context).seed ^ source.salt ^ 0x45d9f3b;
      }
      const oldMesh = work.map.mesh;
      const spatialStep = prepareSpatialStep(state, c, step);
      if (oldMesh !== work.map.mesh) await context.reconcile!();
      const map = work.map;
      restoreAuthoring(work);
      if (name === "temperature" && context.parameters.unforced) map.ExternalHeatForcing.fill(0);
      const selected: NativeStep =
        context.parameters.iceLoad && name === "crustal-support"
          ? [name, source.salt, (map, c) => crustalSupport(map, c, true)]
          : spatialStep;
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
    }),
    validate: validateWorkspace,
  };
}
function nativeRemeshContract(name: string, adaptive: boolean) {
  return adaptive &&
    ["impact-cratering", "volcanic-construction", "fracture-network", "coastal-detail"].includes(
      name
    )
    ? { reconciliation: { invalidates: remeshInvalidations, sequence: [], guarantees: [] } }
    : {};
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
    initializeProcess(),
    absenceInitialization(
      input.resolvedFeatures!,
      inheritedAbsences,
      inheritedNativeFacts(channels)
    ),
    projectProcess(input),
    projectProcess(input, true),
    forcingProcess(),
    epochStartProcess(),
    finishProcess(original),
    ...(original.world.areas[input.areaId].profile === "world"
      ? []
      : [
          adaptiveWaterProcess(input.resolvedFeatures!),
          adaptiveClimateProcess(),
          adaptiveIceProcess(input.resolvedFeatures!),
        ]),
    ...Array.from(implementations.values(), (step) =>
      nativeProcess(
        step,
        input.resolvedFeatures!,
        inheritedAbsences,
        original.world.areas[input.areaId].profile !== "world"
      )
    ),
  ];
}
function initializeProcess(): MapProcess {
  return {
    contract: {
      ...contract(
        "canonry.initialize",
        [],
        ["canonry:workspace", "canonry:SedimentSupply", "canonry:FractureState"]
      ),
      products: [
        {
          id: "canonry:FractureState",
          lifetime: "run",
          representation: "field",
          unit: "per-mille",
          composition: "shared-state",
        },
      ],
    },
    behavior: {
      kind: "initialize",
      initialize(state, context) {
        const bound = generationBindings(context);
        requireThat(
          bound.quality in atlasQuality,
          "generation_quality",
          "Choose draft, standard or fine."
        );
        state.physical = createAtlasWorkspace(
          state,
          bound.quality as keyof typeof atlasQuality,
          bound.parameters,
          configuredPhysicalProfile(bound.features)
        );
        state.physical.map.AvailableFacts.add("SedimentSupply");
      },
    },
    validate: validateWorkspace,
  };
}
function projectProcess(input: AtlasGenerationInput, forcingOnly = false): MapProcess {
  const channels = new Set(selectedAtlasChannels(input.resolvedFeatures!).map(({ name }) => name));
  const projected = atlasPublicationDefinitions(input)
    .filter((definition) => definition.kind === "field" && definition.publish !== false)
    .map((definition) => (definition.kind === "field" ? definition.channel : ""));
  const outputs = forcingOnly
    ? ["elevation", "geology", "fracture", "naturalTemperature", "naturalRock"]
    : [
        ...(channels.has("elevation") ? ["elevation"] : []),
        ...(["bedrock", "rock", "sediment"].every((name) => channels.has(name)) ? ["geology"] : []),
        ...(channels.has("fracture") ? ["fracture"] : []),
        ...(projected.includes("flow") ? ["flow"] : []),
      ];
  return {
    contract: {
      ...contract(
        forcingOnly ? "canonry.project-forcing" : "canonry.project",
        ["canonry:workspace"],
        outputs
      ),
      workspaceOnly: false,
    },
    behavior: {
      kind: "extract",
      extract(state, context) {
        projectNative(
          state,
          forcingOnly,
          !generationBindings(context).domains.includes("physical"),
          forcingOnly ? undefined : selectedAtlasChannels(generationBindings(context).features),
          new Set(
            (state.publications ?? []).flatMap((definition) =>
              definition.kind === "field" && definition.publish !== false
                ? [definition.channel]
                : []
            )
          )
        );
      },
    },
    validate: validateWorkspace,
  };
}
function forcingProcess(): MapProcess {
  return {
    contract: contract("canonry.forcing", ["canonry:workspace"]),
    behavior: {
      kind: "forcing-contributor",
      contribute(state) {
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
    behavior: {
      kind: "initialize",
      initialize(state) {
        const map = state.physical!.map;
        map.ExternalHeatForcing.fill(0);
        map.ExternalCoastalForcing.fill(0);
        map.GlacialMeltwater.fill(0);
        state.physical!.magic?.heat.fill(0);
        state.physical!.magic?.melt.fill(0);
        state.physical!.magic?.coastal.fill(0);
      },
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
    behavior: {
      kind: "extract",
      extract(state, context) {
        const before = new Map(Object.entries(state.domain.world.features));
        const selected = generationBindings(context).features.selection;
        const enabled = (id: string) => selected[id].enabled;
        extractNativeGeography(state, context, {
          oceans: enabled("ocean.geography"),
          impacts: enabled("physical.impacts"),
          volcanism: enabled("physical.volcanism"),
          fractures: enabled("physical.fractures"),
          lakes: enabled("water.routing"),
          landforms: enabled("physical.landforms"),
          magic: enabled("magic.configured") || enabled("magic.local"),
          ecology: enabled("ecology.living"),
          rivers: enabled("physical.river-networks"),
        });
        const generated = new Set(
          Object.values(state.domain.world.features)
            .filter((feature) => before.get(feature.id) !== feature)
            .map((feature) => feature.id)
        );
        retainGeographicIdentities(
          state,
          original,
          state.physical!.map.mesh.spacing * 2,
          generated
        );
      },
    },
    validate: validateWorkspace,
  };
}
