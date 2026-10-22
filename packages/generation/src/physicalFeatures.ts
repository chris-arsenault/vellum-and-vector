import type { ParameterValues } from "@atlas/domain";
import { atlasParameterDefinitions, type AtlasParameters } from "./atlasParameters";
import {
  featureContribution,
  type GenerationFeature,
  type ResolvedFeatures,
  type FeatureContributionContext,
} from "./features";
import type { ProcessInvocation, ProcessSequence } from "./process";
import { physicalInputContract } from "./physicalInputs";
import { atlasGenerationModules } from "./generationModules";
import { physicalApplicability, climateSettings } from "./physicalApplicability";
import { physicalCartography } from "./physicalCartography";
import { clockConfiguration } from "./featureConfiguration";
import type { GenerationSlot } from "./generationSlots";
import { physicalProfileConfiguration } from "./physicalProfileConfiguration";
export { acceptedEmptyByConsumer } from "./physicalInputs";

type Operations = Record<string, (string | [string, ParameterValues])[]>;
type FeatureOptions = {
  settings?: (keyof AtlasParameters)[];
  requires?: string[];
  absent?: string[];
  inherited?: boolean;
  configuration?: Partial<GenerationFeature>;
  when?(slot: string, context?: FeatureContributionContext): boolean;
};

function definition(
  id: string,
  label: string,
  operations: Operations,
  options: FeatureOptions = {}
): GenerationFeature {
  const processes = Object.values(operations)
    .flat()
    .map((entry) => `canonry.${typeof entry === "string" ? entry : entry[0]}`);
  return {
    id,
    label,
    applicability: physicalApplicability[id],
    cartography: [physicalCartography[id] ?? []].flat(),
    domains: options.inherited ? ["physical", "magic"] : ["physical"],
    defaultEnabled: true,
    settings: Object.fromEntries(
      (options.settings ?? []).map((key) => [key, atlasParameterDefinitions[key]])
    ),
    legacyParameters: options.settings ?? [],
    processes: [...new Set(processes)],
    slots: Object.keys(operations) as GenerationSlot[],
    requires: options.requires ?? [],
    absent: (options.absent ?? []).map((product) => ({
      product: `canonry:${product}`,
      initializer: "atlas.absent-physical",
    })),
    contribute(slot, _configuration, context) {
      if (options.when && !options.when(slot, context)) return [];
      return (operations[slot] ?? []).map((entry): ProcessInvocation => {
        const [name, parameters] = typeof entry === "string" ? [entry, {}] : entry;
        return {
          kind: "process",
          id: name,
          process: `canonry.${name}`,
          version: "0f62584c",
          parameters,
        };
      });
    },
    ...(options.configuration ?? physicalProfileConfiguration(id)),
  };
}

/** Features contribute actual operations at known causal occurrences. */
export const physicalFeatureDefinitions: GenerationFeature[] = [
  definition(
    "physical.foundation",
    "Continental foundation",
    {
      "formation.foundation": [
        "tectonic-provinces",
        "continental-sutures",
        "tectonic-margins",
        "continental-domains",
        "tectonic-uplift",
        "landscape-initialization",
      ],
      "epoch.crust.provinces": ["tectonic-provinces"],
      "epoch.crust.structure": [
        "continental-sutures",
        "tectonic-margins",
        "continental-domains",
        "tectonic-uplift",
      ],
    },
    {
      settings: ["continents", "provinces", "landFraction"],
      inherited: true,
      requires: ["physical.lifecycle"],
      when: (slot, context) =>
        !slot.startsWith("epoch.crust.") ||
        Boolean(context?.resolved.selection["physical.tectonic-history"]?.enabled),
    }
  ),
  definition(
    "physical.tectonic-history",
    "Tectonic evolution",
    {
      "epoch.advection": ["plate-advection"],
      "epoch.crust.activity": ["tectonic-epoch-activity"],
    },
    { settings: ["plateDrift"], requires: ["physical.foundation"] }
  ),
  definition(
    "physical.mountains",
    "Mountain construction",
    {
      "formation.mountains": ["orogenic-construction"],
      "epoch.mountains": ["orogenic-construction"],
    },
    { requires: ["physical.foundation"], absent: ["OrogenicConstruction"] }
  ),
  definition(
    "physical.volcanism",
    "Volcanic geography",
    {
      "formation.volcanism": ["mantle-plume-roots", "volcanic-construction"],
      "epoch.volcanism": ["volcanic-construction"],
    },
    {
      settings: ["volcanism"],
      requires: ["physical.foundation"],
      absent: ["MantlePlumeRoots", "VolcanicConstruction"],
    }
  ),
  definition(
    "physical.impacts",
    "Impact geography",
    {
      "formation.impacts": ["impact-cratering"],
      "epoch.impacts": ["impact-cratering"],
    },
    { settings: ["impacts", "impactSize"], requires: ["physical.foundation"], absent: ["Impacts"] }
  ),
  definition(
    "physical.hillslopes",
    "Hillslope transport",
    {
      "material.hillslopes": ["mass-wasting"],
      "epoch.after-incision.hillslopes": ["post-fluvial-mass-wasting"],
    },
    {
      requires: ["physical.foundation"],
      when: (slot, context) =>
        slot !== "epoch.after-incision.hillslopes" ||
        Boolean(context?.resolved.selection["physical.river-incision"]?.enabled),
    }
  ),
  definition(
    "material.load-response",
    "Crust and material load response",
    {
      "material.support.before-margins": ["crustal-support", "lithospheric-flexure"],
      "material.support.after-margins": ["crustal-support", "lithospheric-flexure"],
      "epoch.ice-load": [["crustal-support", { iceLoad: true }], "lithospheric-flexure"],
    },
    { requires: ["physical.foundation"], inherited: true }
  ),
  definition(
    "physical.continental-margins",
    "Continental margins and marine deposits",
    {
      "material.margins": ["continental-margin-evolution", "marine-sedimentation"],
    },
    { requires: ["physical.foundation", "ocean.geography", "material.load-response"] }
  ),
  definition(
    "physical.coastal-construction",
    "Initial coastal construction",
    {
      "formation.coastal-construction": ["coastal-detail"],
    },
    { requires: ["physical.foundation"] }
  ),
  definition(
    "physical.fractures",
    "Fault and fracture network",
    {
      "geology.fractures": ["fracture-network"],
    },
    { requires: ["physical.foundation"], absent: ["Fractures"] }
  ),
  definition(
    "physical.geothermal",
    "Geothermal geography",
    {
      "geology.geothermal": ["geothermal"],
    },
    { requires: ["physical.foundation"], absent: ["Geothermal"], inherited: true }
  ),
  definition(
    "ocean.geography",
    "Ocean and bathymetric geography",
    {
      "material.ocean.before-margins": ["ocean-connectivity"],
      "material.ocean.after-margins": ["ocean-connectivity"],
      "formation.ocean.final": ["ocean-connectivity"],
      "climate.ocean": [
        "ocean-connectivity",
        "ocean-distance",
        "bathymetry",
        "landmasses-and-shelf-groups",
      ],
    },
    { requires: ["physical.foundation"], inherited: true }
  ),
  definition(
    "physical.ocean-circulation",
    "Ocean circulation and heat transport",
    {
      "climate.circulation": ["ocean-currents", "warmth-sources"],
    },
    { requires: ["ocean.geography"], absent: ["OceanCurrents", "Warmth"], inherited: true }
  ),
  definition(
    "physical.climate",
    "Climate",
    {
      "climate.refinement": ["refine-climate"],
      "climate.atmosphere": [
        "temperature",
        "atmospheric-flow",
        "moisture-transport",
        "precipitation",
      ],
    },
    {
      settings: [...climateSettings],
      requires: ["ocean.geography"],
      inherited: true,
      when: (slot, context) => slot !== "climate.refinement" || isRefinement(context),
    }
  ),
  definition(
    "water.routing",
    "Water balance and routing",
    {
      "water.refinement": ["refine-water"],
      "water.runoff": ["runoff"],
      "water.routing": [
        "drainage-conditioning",
        "lake-basins",
        "drainage-guidance",
        "flow-routing",
        "river-network",
      ],
    },
    {
      requires: ["physical.climate", "ocean.geography"],
      inherited: true,
      when: (slot, context) => slot !== "water.refinement" || isRefinement(context),
    }
  ),
  definition(
    "physical.river-incision",
    "River incision",
    {
      "epoch.incision": ["ancestral-fluvial-erosion"],
    },
    { settings: ["erosion"], requires: ["water.routing", "material.fluvial-transport"] }
  ),
  definition(
    "material.fluvial-transport",
    "Fluvial sediment transport",
    {
      "epoch.sediment": ["sediment-transport"],
    },
    {
      requires: ["water.routing", "ocean.geography"],
      absent: ["SedimentTransport"],
      inherited: true,
    }
  ),
  definition(
    "physical.land-ice",
    "Land ice and meltwater",
    {
      "after.model-pass": ["refine-ice"],
      "ice.model": ["land-ice-mass-balance", "ice-flow"],
      "ice.flow": ["ice-flow"],
      "ice.meltwater": ["glacial-meltwater"],
      "water.glacial-runoff": ["glacial-runoff"],
    },
    {
      requires: ["physical.climate", "water.routing", "material.load-response"],
      absent: ["LandIce", "IceFlow", "GlacialMeltwater"],
      inherited: true,
      when: (slot, context) =>
        slot !== "after.model-pass" ||
        (isRefinement(context) &&
          Boolean(context?.iceLoad) &&
          context?.process === "canonry.ice-flow"),
    }
  ),
  definition(
    "physical.glacial-sculpting",
    "Glacial sculpting",
    {
      "epoch.sculpting": ["glacial-erosion", "glacial-deposition"],
      "present.glacial-landforms": ["glacial-landforms"],
    },
    {
      settings: ["glaciers"],
      requires: ["physical.land-ice"],
      absent: ["GlacialEvolution", "GlacialRelief"],
      inherited: true,
    }
  ),
  definition(
    "physical.sea-ice",
    "Sea ice",
    {
      "present.sea-ice": ["sea-ice"],
    },
    { requires: ["physical.climate", "ocean.geography"], absent: ["SeaIce"], inherited: true }
  ),
  definition(
    "physical.coastal-evolution",
    "Coastal evolution",
    {
      "epoch.coasts": ["external-coastal-forcing", "coastal-erosion-and-deposition"],
    },
    {
      settings: ["coastalErosion"],
      requires: ["ocean.geography", "material.fluvial-transport"],
      absent: ["CoastalEvolution"],
    }
  ),
  definition(
    "physical.river-networks",
    "River networks",
    {
      "present.river-geometry": ["river-channel-geometry"],
    },
    { requires: ["water.routing"], absent: ["RiverGeometry"], inherited: true }
  ),
  definition(
    "physical.floodplains",
    "Floodplains",
    {
      "present.floodplains": ["river-floodplains"],
    },
    { requires: ["physical.river-networks"], absent: ["Floodplains"], inherited: true }
  ),
  definition(
    "physical.deltas",
    "Deltas",
    {
      "present.deltas": ["river-delta-formation"],
    },
    {
      requires: ["physical.floodplains", "material.fluvial-transport"],
      absent: ["Deltas"],
      inherited: true,
    }
  ),
  definition(
    "physical.landforms",
    "Landform geography",
    {
      "present.landforms": ["landform-classification"],
    },
    { requires: ["water.routing", "ocean.geography"], absent: ["Landforms"], inherited: true }
  ),
  definition(
    "physical.lifecycle",
    "Formation history",
    {
      "epoch.history": ["physical-epoch-history"],
      "present.validation": ["physical-structural-validation"],
    },
    { inherited: true, configuration: clockConfiguration }
  ),
];

function isRefinement(context?: FeatureContributionContext) {
  return Boolean(context && context.source.world.areas[context.input.areaId].profile !== "world");
}

/** Support identity is the profile slot, independent of requesting features. */
export function physicalFeatureSequence(
  slot: string,
  resolved: ResolvedFeatures,
  context?: FeatureContributionContext
): ProcessSequence {
  const registered = atlasGenerationModules.features();
  const definitions = registered.length ? registered : physicalFeatureDefinitions;
  return definitions
    .filter((feature) => resolved.selection[feature.id])
    .flatMap((feature) => featureContribution(feature, slot, resolved, context));
}

export function nativeFeatureContract(
  name: string,
  resolved: ResolvedFeatures,
  inheritedAbsences: string[] = []
) {
  return physicalInputContract(name, resolved, physicalFeatureDefinitions, inheritedAbsences);
}
