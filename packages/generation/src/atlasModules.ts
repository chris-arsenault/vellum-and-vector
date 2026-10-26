import { atlasGenerationModules, type GenerationModule } from "./generationModules";
import { physicalFeatureDefinitions } from "./physicalFeatures";
import { domainFeatureDefinitions } from "./domainFeatures";
import { atlasNativeProcesses } from "./canonry/atlasProcesses";
import { landmarkProcesses } from "./canonry/landmarkProcesses";
import { ecologyProcesses } from "./canonry/ecologyProcesses";
import { magicProcesses } from "./canonry/magicProcesses";
import { advectAtlasMagic } from "./canonry/atlasMagic";
import { thermalMagicProcess, magicStorageProcess } from "./mapMagic";
import { materialMagicProcess } from "./mapMagicEffects";
import { culturalProcess, politicalProcess } from "./mapPeople";
import { builtProcess } from "./mapBuilt";
import { atlasPublicationDefinitions } from "./canonry/atlasPublications";
import { populationProcesses } from "./societyProcesses";
import { societyPublications } from "./societyPublication";
import { regionalPhysicalProcesses } from "./canonry/regionalPhysical";
import { regionalClimateProcess } from "./canonry/regionalClimate";
import { regionalMagicProcesses } from "./canonry/regionalMagic";

function domainModule(id: string, processes: GenerationModule["processes"]): GenerationModule {
  return {
    id,
    features: domainFeatureDefinitions.filter((feature) => feature.id === id),
    processes,
    publications: (input, world) => atlasPublicationDefinitions(input, world, [id]),
  };
}

/** Static registration is shared by editor and worker; behavior belongs to features. */
atlasGenerationModules.register({
  id: "human.population",
  features: [],
  processes: () => populationProcesses,
  publications: societyPublications,
});
atlasGenerationModules.register({
  id: "atlas.physical",
  features: physicalFeatureDefinitions,
  processes: (source, input) => [
    ...atlasNativeProcesses(input, source),
    ...landmarkProcesses,
    ...regionalPhysicalProcesses,
    regionalClimateProcess,
    ...regionalMagicProcesses,
  ],
  publications: (input, world) =>
    atlasPublicationDefinitions(
      input,
      world,
      physicalFeatureDefinitions.map((feature) => feature.id)
    ),
});
atlasGenerationModules.register(
  domainModule("ecology.living", (_source, input) => ecologyProcesses(input))
);
atlasGenerationModules.register(
  domainModule("magic.configured", (_source, input) =>
    magicProcesses(input.settings?.magicSystems, input.settings?.confluences)
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
atlasGenerationModules.register(domainModule("human.cultures", () => [culturalProcess]));
atlasGenerationModules.register(domainModule("human.politics", () => [politicalProcess]));
atlasGenerationModules.register(
  domainModule("built.layout", (source, input) => {
    const profile = source.world.areas[input.areaId].profile;
    return [
      ["site", "interior"].includes(profile)
        ? builtProcess
        : { ...builtProcess, contract: { ...builtProcess.contract, requires: ["elevation"] } },
    ];
  })
);

export { atlasGenerationModules };
