import { requireThat, type DomainSnapshot } from "@atlas/domain";
import type { GenerationState, MapProcess, MapProcessContext } from "../process";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import { markPoiLandforms } from "../poi/poiLandforms";
import { allSteps, applyNativeStep, fieldProduct, physicalSteps } from "./physicalSteps";
import { nativeContext } from "./context";
import { atlasQuality } from "./atlasProfile";
import { configuredPhysicalProfile } from "../physicalProfileConfiguration";
import {
  composeNativeAuthoring,
  createAtlasWorkspace,
  parentChannels,
  type AtlasPhysicalWorkspace,
} from "./atlasWorkspace";
import { projectNative } from "./atlasProjection";
import { extractNativeGeography } from "./atlasFeatures";
import { extractConfluencePlaces } from "./geographicRegions";
import { publishKinds } from "../poi/poiPublish";
import { contributeForcing } from "./atlasForcing";
import { featureRevisions } from "../generationFeatures";
import { reconcileWater } from "./field";
import type { NativeStep } from "./sequence";
import { advectMagic } from "./magicState";
import { retainGeographicIdentities } from "./geographicIdentity";
import { refreshGrounding } from "./glacierSurface";
import { adaptiveReliefProcess } from "./adaptiveRelief";
import { applyPlaceEffects } from "../poi/poiEffects";
import { generationBindings } from "../generationBindings";
import { absenceInitialization } from "./absenceInitialization";
import { nativeBehavior } from "./physicalProducts";
import { atlasPublicationDefinitions, selectedAtlasChannels } from "./atlasPublications";
import { inheritedChannelNames, inheritedProducts } from "./inheritedFacts";

const nativeFlags: MapProcess["contract"]["parameters"] = {
  iceLoad: { type: "boolean", unit: null, required: false, default: false },
  initial: { type: "boolean", unit: null, required: false, default: false },
  unforced: { type: "boolean", unit: null, required: false, default: false },
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
    if (binding.native !== "Elevation") continue;
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
function nativeProcess(step: NativeStep): MapProcess {
  const [name, salt] = step,
    declared = physicalSteps[name];
  return {
    contract: {
      ...contract(
        `atlas.${name}`,
        ["atlas:workspace", ...declared.needs.map(fieldProduct)],
        [...declared.writes.map(fieldProduct), ...declared.leaves]
      ),
      parameters: nativeFlags,
    },
    behavior: nativeBehavior(declared.movesMaterial, async (state, context) => {
      const work = state.physical!;
      const c = {
        ...nativeContext(state, context, salt),
        IceLoad: Boolean(context.parameters.iceLoad),
        // Magic rides the crust: what it carries moves whenever the plates do.
        AfterPlateStep: () => advectMagic(state),
      };
      if (context.parameters.initial) {
        c.EpochIndex = 0;
        c.Seed = generationBindings(context).seed ^ salt ^ 0x45d9f3b;
      }
      restoreAuthoring(work);
      if (context.parameters.unforced) work.map.ExternalHeatForcing.fill(0);
      applyNativeStep(work.map, c, step);
      restoreAuthoring(work);
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
    ...allSteps.map(nativeProcess),
  ];
}
function initializeProcess(): MapProcess {
  return {
    contract: contract(
      "atlas.initialize",
      [],
      ["atlas:workspace", fieldProduct("SedimentSupply"), fieldProduct("FractureConductance")]
    ),
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
        if (state.physical.inherited)
          for (const product of inheritedProducts([
            ...Object.keys(state.surface.channels),
            ...parentChannels(state).keys(),
          ]))
            context.products?.produce(product);
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
        forcingOnly ? "atlas.project-forcing" : "atlas.project",
        ["atlas:workspace"],
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
    contract: contract("atlas.forcing", ["atlas:workspace"]),
    behavior: { kind: "forcing-contributor", contribute: contributeForcing },
    validate: validateWorkspace,
  };
}
/** Each place's own effects on the field, declared afresh as the epoch closes. */
function placeEffectsProcess(): MapProcess {
  return {
    contract: contract("poi.effects", ["atlas:workspace"]),
    behavior: { kind: "forcing-contributor", contribute: applyPlaceEffects },
    validate: validateWorkspace,
  };
}
function epochStartProcess(): MapProcess {
  return {
    contract: contract("atlas.begin-epoch", ["atlas:workspace"]),
    behavior: {
      kind: "initialize",
      initialize(state) {
        const map = state.physical!.map;
        map.ExternalHeatForcing.fill(0);
        map.ExternalCoastalForcing.fill(0);
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
      ...contract("atlas.features", ["atlas:validated"], ["geographicFeatures"]),
      workspaceOnly: false,
    },
    behavior: {
      kind: "extract",
      extract(state, context) {
        const before = new Map(featureRevisions(state));
        const selected = generationBindings(context).features.selection;
        const enabled = (id: string) => selected[id].enabled;
        extractNativeGeography(state, context, {
          oceans: enabled("ocean.geography"),
          impacts: enabled("physical.impacts"),
          volcanism: enabled("physical.volcanism"),
          fractures: enabled("physical.fractures"),
          lakes: enabled("water.routing"),
          landforms: enabled("physical.landforms"),
          ecology: enabled("ecology.living"),
          rivers: enabled("physical.river-networks"),
          landmarks: enabled("physical.landmarks"),
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
    },
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
    behavior: {
      kind: "extract",
      extract(state, context) {
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
    },
    validate: () => [],
  };
}
