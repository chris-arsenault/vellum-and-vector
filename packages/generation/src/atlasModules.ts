import { z } from "zod";
import { ecologyEpochSchema, requireThat, type ParameterValues } from "@atlas/domain";
import { atlasGenerationModules, type GenerationModule } from "./generationModules";
import type { GenerationFeature, ResolvedFeatures } from "./features";
import { physicalFeatureDefinitions } from "./physicalFeatures";
import { domainFeatureDefinitions } from "./domainFeatures";
import { atlasNativeProcesses } from "./canonry/atlasProcesses";
import { ecologyProcesses } from "./canonry/ecologyProcesses";
import { magicProcesses } from "./canonry/magicProcesses";
import { advectAtlasMagic } from "./canonry/atlasMagic";
import { thermalMagicProcess, magicStorageProcess } from "./mapMagic";
import { materialMagicProcess } from "./mapMagicEffects";
import { culturalProcess, politicalProcess } from "./mapPeople";
import { builtProcess } from "./mapBuilt";
import type { AtlasParameters } from "./atlasParameters";
import { atlasPublicationDefinitions } from "./canonry/atlasPublications";
import {
  generationEpochSchema,
  generationSettingsSchema,
  humanEraSchema,
  type GenerationSettings,
} from "./generationSettings";

const physicalEpoch = generationEpochSchema.omit({ ecology: true, magicActivity: true });
const clockSchema = z.object({ epochs: z.array(physicalEpoch).min(1) }).strict();
const ecologySchema = z
  .object({ epochs: z.record(z.string(), ecologyEpochSchema.strict()) })
  .strict();
const magicSchema = z
  .object({
    magicSystems: generationSettingsSchema.shape.magicSystems,
    activity: z.record(z.string(), z.record(z.string(), z.number().finite().nonnegative())),
  })
  .strict();
const culturalSchema = z
  .object({ eras: z.array(humanEraSchema.omit({ physicalEpoch: true, politicalCapacity: true })) })
  .strict();
const legacy = (settings: ParameterValues) => generationSettingsSchema.parse(settings);

function ownPhysicalConfiguration(feature: GenerationFeature): GenerationFeature {
  if (feature.id !== "physical.lifecycle") return feature;
  return {
    ...feature,
    configuration: clockSchema,
    configurationFromLegacy(settings) {
      return {
        epochs: legacy(settings).epochs.map((epoch) =>
          physicalEpoch.parse(epochWithoutExtensions(epoch))
        ),
      };
    },
  };
}
function epochWithoutExtensions(epoch: GenerationSettings["epochs"][number]) {
  const { ecology: _ecology, magicActivity: _magic, ...physical } = epoch;
  void _ecology;
  void _magic;
  return physical;
}
function ownedDomainConfiguration(feature: GenerationFeature): GenerationFeature {
  feature = {
    ...feature,
    legacyParameters: Object.keys(feature.settings) as (keyof AtlasParameters)[],
  };
  if (feature.id === "ecology.living")
    return {
      ...feature,
      configuration: ecologySchema,
      configurationFromLegacy: (settings) => ({
        epochs: Object.fromEntries(
          legacy(settings).epochs.map((epoch) => [
            epoch.id,
            ecologyEpochSchema.parse(epoch.ecology ?? {}),
          ])
        ),
      }),
    };
  if (feature.id === "magic.configured")
    return {
      ...feature,
      configuration: magicSchema,
      configurationFromLegacy: (settings) => ({
        magicSystems: legacy(settings).magicSystems,
        activity: Object.fromEntries(
          legacy(settings).epochs.map((epoch) => [epoch.id, epoch.magicActivity ?? {}])
        ),
      }),
    };
  if (feature.id === "human.cultures")
    return {
      ...feature,
      configuration: culturalSchema,
      configurationFromLegacy: (settings) => ({
        eras: legacy(settings).humanEras.map(({ id, years, mobility }) => ({
          id,
          years,
          mobility,
        })),
      }),
    };
  return feature;
}
function configureClock(features: ResolvedFeatures, settings: GenerationSettings) {
  const bound = clockSchema.parse(features.selection["physical.lifecycle"].configuration);
  return projectClock(bound, settings);
}
function projectClock(bound: z.infer<typeof clockSchema>, settings: GenerationSettings) {
  return {
    ...settings,
    epochs: bound.epochs.map((epoch) => ({
      ...epoch,
      ecology: settings.epochs.find((item) => item.id === epoch.id)?.ecology ?? {},
      magicActivity: settings.epochs.find((item) => item.id === epoch.id)?.magicActivity ?? {},
    })),
  };
}
function configureEcology(features: ResolvedFeatures, settings: GenerationSettings) {
  const bound = ecologySchema.parse(features.selection["ecology.living"].configuration);
  checkEpochs(Object.keys(bound.epochs), settings);
  return {
    ...settings,
    epochs: settings.epochs.map((epoch) => ({
      ...epoch,
      ecology: bound.epochs[epoch.id] ?? epoch.ecology,
    })),
  };
}
function configureMagic(features: ResolvedFeatures, settings: GenerationSettings) {
  const bound = magicSchema.parse(features.selection["magic.configured"].configuration);
  checkEpochs(Object.keys(bound.activity), settings);
  const systems = new Set(bound.magicSystems.map((system) => system.id));
  for (const activity of Object.values(bound.activity))
    for (const id of Object.keys(activity))
      requireThat(
        systems.has(id),
        "magic_activity",
        `Bind activity to an existing magical system: ${id}.`
      );
  return {
    ...settings,
    magicSystems: bound.magicSystems,
    epochs: settings.epochs.map((epoch) => ({
      ...epoch,
      magicActivity: bound.activity[epoch.id] ?? {},
    })),
  };
}
function configureCultures(features: ResolvedFeatures, settings: GenerationSettings) {
  const bound = culturalSchema.parse(features.selection["human.cultures"].configuration);
  return {
    ...settings,
    humanEras: bound.eras.map((era) => ({
      ...era,
      physicalEpoch: settings.humanEras.find((item) => item.id === era.id)?.physicalEpoch ?? null,
      politicalCapacity:
        settings.humanEras.find((item) => item.id === era.id)?.politicalCapacity ?? 1,
    })),
  };
}
function checkEpochs(ids: string[], settings: GenerationSettings) {
  const known = new Set(settings.epochs.map((epoch) => epoch.id));
  for (const id of ids)
    requireThat(known.has(id), "feature_epoch", `Bind settings to an existing epoch: ${id}.`);
}
function domainModule(
  id: string,
  process: GenerationModule["processes"],
  bindSettings?: GenerationModule["bindSettings"]
): GenerationModule {
  const features = domainFeatureDefinitions
    .filter((feature) => feature.id === id)
    .map(ownedDomainConfiguration);
  return {
    id,
    features,
    processes: process,
    bindSettings,
    publications: (input, world) => atlasPublicationDefinitions(input, world, [id]),
  };
}

/** This is the application composition root shared by editor and worker. */
atlasGenerationModules.register({
  id: "atlas.physical",
  features: physicalFeatureDefinitions.map(ownPhysicalConfiguration),
  processes: (source, input) => atlasNativeProcesses(input, source),
  bindSettings: configureClock,
  prepareSettings(selected, settings) {
    const draft = selected["physical.lifecycle"]?.configuration;
    if (!draft) return settings;
    const bound = clockSchema.parse({
      epochs: settings.epochs.map(epochWithoutExtensions),
      ...draft,
    });
    return projectClock(bound, settings);
  },
  publications: (input, world) =>
    atlasPublicationDefinitions(
      input,
      world,
      physicalFeatureDefinitions.map((feature) => feature.id)
    ),
});
atlasGenerationModules.register(
  domainModule("ecology.living", (_source, input) => ecologyProcesses(input), configureEcology)
);
atlasGenerationModules.register(
  domainModule(
    "magic.configured",
    (_source, input) => magicProcesses(input.settings?.magicSystems),
    configureMagic
  )
);
atlasGenerationModules.register(
  domainModule("magic.local", () => [
    thermalMagicProcess,
    magicStorageProcess,
    materialMagicProcess,
    advectAtlasMagic,
  ])
);
atlasGenerationModules.register(
  domainModule("human.cultures", () => [culturalProcess], configureCultures)
);
atlasGenerationModules.register(domainModule("human.politics", () => [politicalProcess]));
atlasGenerationModules.register(domainModule("built.layout", () => [builtProcess]));

export { atlasGenerationModules };
