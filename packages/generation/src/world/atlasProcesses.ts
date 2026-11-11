import { mapCommand, processOwner } from "../processTraits";
import { runOperation } from "../processOperation";
import { requireThat, type DomainSnapshot } from "@atlas/domain";
import { decayMaintainedGround } from "../societyRecord";
import type { GenerationState, MapProcess, MapProcessContext } from "../process";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import { markPoiLandforms } from "../poi/poiLandforms";
import {
  allSteps,
  applyNativeStep,
  fieldProduct,
  describeNativeStep,
  withPlateDeformation,
} from "./physicalSteps";
import { plateDeformationSteps, bindFeatureQueries } from "../physicalFeatureSequence";
import { nativeContext } from "./context";
import { atlasQuality } from "./atlasProfile";
import { configuredPhysicalProfile } from "../physicalProfileConfiguration";
import {
  composeNativeAuthoring,
  createAtlasWorkspace,
  parentChannels,
  type AtlasPhysicalWorkspace,
} from "./atlasWorkspace";
import { projectNative, selectedNativeProjection } from "./atlasProjection";
import { extractNativeGeography } from "./atlasFeatures";
import { extractConfluencePlaces } from "./geographicRegions";
import { publishKinds } from "../poi/poiPublish";
import { contributeForcing } from "./atlasForcing";
import { bindCoastalForcing } from "./coastalForcing";
import { featureRevisions } from "../generationFeatures";
import { reconcileWater } from "./field";
import type { NativeStep } from "./sequence";
import { advectMagic } from "./magicState";
import { retainGeographicIdentities } from "./geographicIdentity";
import { refreshGrounding } from "./glacierSurface";
import { adaptiveReliefProcess } from "./adaptiveRelief";
import { applyPlaceEffects, bindPlaceInfluences } from "../poi/poiEffects";
import { generationBindings } from "../generationBindings";
import { absenceInitialization } from "./absenceInitialization";
import { nativeMapOperation } from "./physicalProducts";
import { atlasPublicationDefinitions, selectedAtlasChannels } from "./atlasPublications";
import { inheritedChannelNames, inheritedProducts } from "./inheritedFacts";

const nativeFlags: MapProcess["contract"]["parameters"] = {
  initial: { type: "boolean", unit: null, required: false, default: false },
  workSpan: { type: "number", unit: null, required: false, default: 1 },
};
const contract = (id: string, requires: string[] = [], produces: string[] = []) => ({
  id,
  version: "1",
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
    if (binding.name !== "Elevation") continue;
    for (let i = 0; i < values.length; i++)
      if (Number.isFinite(values.get(i))) reconcileWater(work.map, i);
  }
  refreshGrounding(work.map, work.profile);
}
/** What the atlas records beyond the field once a step has run, by the step it follows. */
const afterStep: Readonly<
  Record<string, (state: GenerationState, context: MapProcessContext, epoch: number) => void>
> = {
  "landform-classification": (state) => markPoiLandforms(state),
  "physical-epoch-history": (_state, context, epoch) =>
    context.recordCause({
      kind: "domain",
      process: "atlas.physical-epoch-history",
      subjects: [],
      description: `Epoch ${epoch + 1}: the selected geological, river, ice and coastal processes retained their material histories. Omitted processes added no new events.`,
    }),
};
export function nativeProcess(
  step: NativeStep,
  deformation: readonly NativeStep[] = []
): MapProcess {
  const [name, salt] = step,
    declared = describeNativeStep(step);
  return {
    contract: {
      ...contract(
        `atlas.${name}`,
        ["atlas:workspace", ...declared.needs.map(fieldProduct)],
        [...declared.writes.map(fieldProduct), ...declared.leaves]
      ),
      parameters: nativeFlags,
    },
    operation: nativeMapOperation(`atlas.${name}`, step[2], (state, context, exposure) => {
      const work = state.physical!;
      const c = {
        ...nativeContext(state, context, salt),
        // Magic rides the crust: what it carries moves whenever the plates do.
        AfterPlateStep: () => advectMagic(state),
      };
      c.Span = exposure;
      c.LocalDevelopment = "regional" in state && exposure > 0;
      if (context.parameters.initial) {
        c.EpochIndex = 0;
        c.Seed = generationBindings(context).seed ^ salt ^ 0x45d9f3b;
      }
      if (step[2].kind !== "query") restoreAuthoring(work);
      applyNativeStep(
        work.map,
        name === "plate-advection" ? withPlateDeformation(work.map, c, deformation) : c,
        step
      );
      if (step[2].kind !== "query") restoreAuthoring(work);
      afterStep[name]?.(state, context, c.EpochIndex);
    }),
    validate: validateWorkspace,
  };
}
export function atlasNativeProcesses(
  input: AtlasGenerationInput,
  original: DomainSnapshot
): MapProcess[] {
  const channels = inheritedChannelNames(
    original,
    input.areaId,
    input.domains.includes("physical")
  );
  const deformation = plateDeformationSteps(input.resolvedFeatures!, {
    source: original,
    input,
    resolved: input.resolvedFeatures!,
  });
  return [
    initializeProcess(),
    absenceInitialization(input.resolvedFeatures!, channels),
    projectProcess(input),
    projectProcess(input, true),
    forcingProcess(),
    placeEffectsProcess(),
    epochStartProcess(),
    finishProcess(original),
    magicPlacesProcess(original),
    ...(original.world.areas[input.areaId].profile === "world" ? [] : [adaptiveReliefProcess()]),
    ...allSteps.map((step) => nativeProcess(step, deformation)),
  ];
}
function initializeProcess(): MapProcess {
  return {
    contract: contract(
      "atlas.initialize",
      [],
      ["atlas:workspace", fieldProduct("SedimentSupply"), fieldProduct("FractureConductance")]
    ),
    operation: mapCommand(
      "atlas.initialize",
      "initialize",
      (state, context) => {
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
        bindFeatureQueries(state.physical.map, bound.features, bound.seed);
        bindPlaceInfluences(state);
        bindCoastalForcing(state);
        if (state.physical.inherited)
          for (const product of inheritedProducts([
            ...Object.keys(state.surface.channels),
            ...parentChannels(state).keys(),
          ]))
            context.products?.produce(product);
      },
      []
    ),
    validate: validateWorkspace,
  };
}
function projectProcess(input: AtlasGenerationInput, forcingOnly = false): MapProcess {
  const channels = new Set(selectedAtlasChannels(input.resolvedFeatures!).map(({ name }) => name));
  const projected = atlasPublicationDefinitions(input)
    .filter((definition) => definition.kind === "field" && definition.publish !== false)
    .map((definition) => (definition.kind === "field" ? definition.channel : ""));
  const outputs = forcingOnly
    ? [
        "Elevation",
        "geology",
        "FractureConductance",
        "NaturalTemperature",
        "NaturalRockResistance",
        "BaseSeaLevel",
        "EffectiveSeaLevel",
      ]
    : [
        ...(channels.has("Elevation") ? ["Elevation"] : []),
        ...((["BedrockElevation", "RockResistance", "SedimentThickness"] as const).every((name) =>
          channels.has(name)
        )
          ? ["geology"]
          : []),
        ...(channels.has("FractureConductance") ? ["FractureConductance"] : []),
        ...(projected.includes("FlowAccumulation") ? ["FlowAccumulation"] : []),
      ];
  return {
    contract: {
      ...contract(
        forcingOnly ? "atlas.project-forcing" : "atlas.project",
        ["atlas:workspace"],
        outputs
      ),
      workspaceOnly: false,
    },
    operation: mapCommand(
      forcingOnly ? "atlas.project-forcing" : "atlas.project",
      "publish",
      (state, context) => {
        runOperation(
          processOwner(state),
          projectNative,
          selectedNativeProjection(state, context, forcingOnly)
        );
      },
      []
    ),
    validate: validateWorkspace,
  };
}
function forcingProcess(): MapProcess {
  return {
    contract: {
      ...contract("atlas.forcing", ["atlas:workspace"]),
      parameters: {
        includeStandalone: { type: "boolean", unit: null, required: false, default: true },
      },
    },
    operation: mapCommand(
      "atlas.forcing",
      "event",
      (state, context) =>
        runOperation(processOwner(state), contributeForcing, {
          state,
          includeStandalone: Boolean(context.parameters.includeStandalone),
        }),
      []
    ),
    validate: validateWorkspace,
  };
}
/** Each place's own effects on the field, declared afresh as the epoch closes. */
function placeEffectsProcess(): MapProcess {
  return {
    contract: contract("poi.effects", ["atlas:workspace"]),
    operation: mapCommand("poi.effects", "event", applyPlaceEffects, []),
    validate: validateWorkspace,
  };
}
function epochStartProcess(): MapProcess {
  return {
    contract: contract("atlas.begin-epoch", ["atlas:workspace"]),
    operation: mapCommand(
      "atlas.begin-epoch",
      "event",
      (state, context) => {
        const map = state.physical!.map;
        decayMaintainedGround(
          map,
          state.physical!.inherited ? 0 : (context.epochs[0]?.duration ?? 0)
        );
        map.ExternalHeatForcing.fill(0);
        map.ExternalMeltwater.fill(0);
        map.GroundwaterReturn.fill(0);
        map.OrganicBurialInput.fill(0);
        map.OrganicBurialThickness.fill(0);
        map.ExternalCoastalForcing.fill(0);
        state.physical!.magic?.heat.fill(0);
        state.physical!.magic?.melt.fill(0);
        state.physical!.magic?.coastal.fill(0);
      },
      []
    ),
    validate: validateWorkspace,
  };
}
function finishProcess(original: DomainSnapshot): MapProcess {
  return {
    contract: {
      ...contract("atlas.features", ["atlas:validated"], ["geographicFeatures"]),
      workspaceOnly: false,
    },
    operation: mapCommand(
      "atlas.features",
      "publish",
      (state, context) => {
        const before = new Map(featureRevisions(state));
        const selected = generationBindings(context).features.selection;
        const enabled = (id: string) => selected[id].enabled;
        runOperation(processOwner(state), extractNativeGeography, {
          state,
          context,
          deliveries: {
            oceans: enabled("ocean.geography"),
            impacts: enabled("physical.impacts"),
            volcanism: enabled("physical.volcanism"),
            fractures: enabled("physical.fractures"),
            lakes: enabled("water.routing"),
            landforms: enabled("physical.landforms"),
            ecology: enabled("ecology.living"),
            rivers: enabled("physical.river-networks"),
            landmarks: enabled("physical.landmarks"),
          },
        });
        const generated = new Set(
          [...featureRevisions(state)]
            .filter(([id, revision]) => before.get(id) !== revision)
            .map(([id]) => id)
        );
        retainGeographicIdentities(
          state,
          original,
          state.physical!.map.mesh.spacing * 2,
          generated
        );
      },
      []
    ),
    validate: validateWorkspace,
  };
}

/** Named magic geography consumes the completed field after the optional human history. */
export function magicPlacesProcess(original: DomainSnapshot): MapProcess {
  return {
    contract: {
      ...contract("atlas.magic-places", [], ["magicalPlaces"]),
      workspaceOnly: false,
    },
    operation: mapCommand(
      "atlas.magic-places",
      "publish",
      (state, context) => {
        if (!state.physical) return;
        context.progress(0, "Extracting magical places");
        const before = new Map(featureRevisions(state));
        extractConfluencePlaces(state);
        publishKinds(state, "magic");
        const generated = new Set(
          [...featureRevisions(state)]
            .filter(([id, revision]) => before.get(id) !== revision)
            .map(([id]) => id)
        );
        retainGeographicIdentities(state, original, state.physical.map.mesh.spacing * 2, generated);
        context.progress(1, "Magical places extracted");
      },
      []
    ),
    validate: () => [],
  };
}
