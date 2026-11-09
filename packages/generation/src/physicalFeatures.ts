import type { FeatureContributionContext } from "./features";
import { climateSettings } from "./physicalApplicability";
import { clockConfiguration } from "./featureConfiguration";
import { landmarkFeature } from "./landmarkFeature";
import { physicalFeature, type PhysicalFeature } from "./physicalFeature";
import {
  nativeSteps,
  runoffStep,
  routingSteps,
  incisionStage,
  sedimentStep,
} from "./world/sequence";

/** Features contribute actual operations at known causal occurrences. */
export const physicalFeatureDefinitions: PhysicalFeature[] = [
  physicalFeature(
    "physical.foundation",
    "Continental foundation",
    {
      "formation.foundation": [
        nativeSteps.tectonicProvinces,
        nativeSteps.continentalSutures,
        nativeSteps.tectonicMargins,
        nativeSteps.continentalDomains,
        nativeSteps.tectonicUplift,
        nativeSteps.landscapeInitialization,
      ],
      "epoch.crust.provinces": [nativeSteps.tectonicProvinces],
      "epoch.crust.structure": [
        nativeSteps.tectonicMargins,
        nativeSteps.continentalDomains,
        nativeSteps.tectonicUplift,
      ],
      "epoch.mountains": [nativeSteps.continentalSutures],
    },
    {
      settings: [
        "continents",
        "oceanicPlates",
        "provinces",
        "continentalCrustFraction",
        "landFraction",
        "mapBoundary",
      ],
      inherited: true,
      requires: ["physical.lifecycle"],
      when: (slot, context) =>
        !slot.startsWith("epoch.crust.") ||
        Boolean(context?.resolved.selection["physical.tectonic-history"]?.enabled),
    }
  ),
  physicalFeature(
    "physical.tectonic-history",
    "Tectonic evolution",
    {
      "epoch.advection": [nativeSteps.plateAdvection],
      "epoch.crust.activity": [nativeSteps.tectonicEpochActivity],
    },
    { settings: ["plateDrift"], requires: ["physical.foundation"] }
  ),
  physicalFeature(
    "physical.mountains",
    "Mountain construction",
    {
      "formation.mountains": [nativeSteps.orogenicConstruction],
      "epoch.mountains": [nativeSteps.orogenicConstruction],
      // A child realizes the relief its parent's cells left latent (ADR 0005).
      "terrain.refinement": ["refine-relief"],
    },
    {
      requires: ["physical.foundation"],
      absent: ["OrogenicConstruction"],
      when: (slot, context) => slot !== "terrain.refinement" || isRefinement(context),
    }
  ),
  physicalFeature(
    "physical.volcanism",
    "Volcanic geography",
    {
      "formation.volcanism": [nativeSteps.mantlePlumeRoots, nativeSteps.volcanicConstruction],
      "epoch.volcanism": [nativeSteps.volcanicConstruction],
    },
    {
      settings: ["volcanism"],
      requires: ["physical.foundation"],
      absent: ["MantlePlumeRoots", "VolcanicConstruction"],
    }
  ),
  physicalFeature(
    "physical.impacts",
    "Impact geography",
    {
      "formation.impacts": [nativeSteps.impactCratering],
      "epoch.impacts": [nativeSteps.impactCratering],
    },
    { settings: ["impacts", "impactSize"], requires: ["physical.foundation"], absent: ["Impacts"] }
  ),
  landmarkFeature,
  physicalFeature(
    "physical.hillslopes",
    "Hillslope transport",
    {
      "material.hillslopes": [nativeSteps.massWasting],
      "epoch.after-incision.hillslopes": [nativeSteps.postFluvialMassWasting],
    },
    {
      requires: ["physical.foundation"],
      when: (slot, context) =>
        slot !== "epoch.after-incision.hillslopes" ||
        Boolean(context?.resolved.selection["physical.river-incision"]?.enabled),
    }
  ),
  physicalFeature(
    "material.load-response",
    "Crust and material load response",
    {
      "material.relaxation": [nativeSteps.crustalRelaxation],
      "material.support.before-margins": [
        nativeSteps.crustalSupport,
        nativeSteps.lithosphericFlexure,
      ],
      "material.support.after-margins": [
        nativeSteps.crustalSupport,
        nativeSteps.lithosphericFlexure,
      ],
      "epoch.ice-load": [nativeSteps.crustalSupport, nativeSteps.lithosphericFlexure],
    },
    { requires: ["physical.foundation"], inherited: true }
  ),
  physicalFeature(
    "physical.continental-margins",
    "Continental margins and marine deposits",
    {
      "material.margins": [nativeSteps.continentalMarginEvolution, nativeSteps.marineSedimentation],
    },
    { requires: ["physical.foundation", "ocean.geography", "material.load-response"] }
  ),
  physicalFeature(
    "physical.coastal-construction",
    "Initial coastal construction",
    {
      "formation.coastal-construction": [nativeSteps.coastalDetail],
    },
    { requires: ["physical.foundation"] }
  ),
  physicalFeature(
    "physical.fractures",
    "Fault and fracture network",
    {
      "geology.fractures": [nativeSteps.fractureNetwork],
    },
    { requires: ["physical.foundation"], absent: ["Fractures"] }
  ),
  physicalFeature(
    "physical.geothermal",
    "Geothermal geography",
    {
      "geology.geothermal": [nativeSteps.geothermal],
    },
    { requires: ["physical.foundation"], absent: ["Geothermal"], inherited: true }
  ),
  physicalFeature(
    "ocean.geography",
    "Ocean and bathymetric geography",
    {
      "material.ocean.before-margins": [nativeSteps.oceanConnectivity],
      "material.ocean.after-margins": [nativeSteps.oceanConnectivity],
      "formation.ocean.final": [nativeSteps.oceanConnectivity],
      "climate.ocean": [
        nativeSteps.oceanConnectivity,
        nativeSteps.oceanDistance,
        nativeSteps.bathymetry,
        nativeSteps.landmassesAndShelfGroups,
      ],
    },
    { requires: ["physical.foundation"], inherited: true }
  ),
  physicalFeature(
    "physical.ocean-circulation",
    "Ocean circulation and heat transport",
    {
      "climate.circulation": [nativeSteps.oceanCurrents, nativeSteps.warmthSources],
    },
    { requires: ["ocean.geography"], absent: ["OceanCurrents", "Warmth"], inherited: true }
  ),
  physicalFeature(
    "physical.climate",
    "Climate",
    {
      "climate.atmosphere": [
        nativeSteps.temperature,
        nativeSteps.atmosphericFlow,
        nativeSteps.moistureTransport,
        nativeSteps.precipitation,
      ],
    },
    {
      settings: [...climateSettings],
      requires: ["ocean.geography"],
      inherited: true,
    }
  ),
  physicalFeature(
    "water.routing",
    "Water balance and routing",
    {
      "water.runoff": [runoffStep],
      "water.routing": routingSteps,
    },
    {
      requires: ["physical.climate", "ocean.geography"],
      inherited: true,
    }
  ),
  physicalFeature(
    "physical.river-incision",
    "River incision",
    {
      "epoch.incision": incisionStage,
    },
    { settings: ["erosion"], requires: ["water.routing", "material.fluvial-transport"] }
  ),
  physicalFeature(
    "material.fluvial-transport",
    "Fluvial sediment transport",
    {
      "epoch.sediment": [sedimentStep],
    },
    {
      requires: ["water.routing", "ocean.geography"],
      absent: ["SedimentTransport"],
      inherited: true,
    }
  ),
  physicalFeature(
    "physical.land-ice",
    "Land ice and meltwater",
    {
      "ice.model": [nativeSteps.landIceMassBalance, nativeSteps.iceFlow],
      "ice.flow": [nativeSteps.iceFlow],
      "ice.meltwater": [nativeSteps.glacialMeltwater],
      "water.glacial-runoff": [nativeSteps.glacialRunoff],
    },
    {
      requires: ["physical.climate", "water.routing", "material.load-response"],
      absent: ["LandIce", "IceFlow", "GlacialMeltwater"],
      inherited: true,
    }
  ),
  physicalFeature(
    "physical.glacial-sculpting",
    "Glacial sculpting",
    {
      "epoch.sculpting": [nativeSteps.glacialErosion, nativeSteps.glacialDeposition],
      "present.glacial-landforms": [nativeSteps.glacialLandforms],
    },
    {
      settings: ["glaciers"],
      requires: ["physical.land-ice"],
      absent: ["GlacialEvolution", "GlacialRelief"],
      inherited: true,
    }
  ),
  physicalFeature(
    "physical.sea-ice",
    "Sea ice",
    {
      "present.sea-ice": [nativeSteps.seaIce],
    },
    { requires: ["physical.climate", "ocean.geography"], absent: ["SeaIce"], inherited: true }
  ),
  physicalFeature(
    "physical.coastal-evolution",
    "Coastal evolution",
    {
      "epoch.coasts": [nativeSteps.externalCoastalForcing, nativeSteps.coastalErosionAndDeposition],
    },
    {
      settings: ["coastalErosion"],
      requires: ["ocean.geography", "material.fluvial-transport"],
      absent: ["CoastalEvolution"],
    }
  ),
  physicalFeature(
    "physical.river-networks",
    "River networks",
    {
      "present.river-geometry": [nativeSteps.riverChannelGeometry],
    },
    { requires: ["water.routing"], absent: ["RiverGeometry"], inherited: true }
  ),
  physicalFeature(
    "physical.floodplains",
    "Floodplains",
    {
      "present.floodplains": [nativeSteps.riverFloodplains],
    },
    { requires: ["physical.river-networks"], absent: ["Floodplains"], inherited: true }
  ),
  physicalFeature(
    "physical.deltas",
    "Deltas",
    {
      "present.deltas": [nativeSteps.riverDeltaFormation],
    },
    {
      requires: ["physical.floodplains", "material.fluvial-transport"],
      absent: ["Deltas"],
      inherited: true,
    }
  ),
  physicalFeature(
    "physical.landforms",
    "Landform geography",
    {
      "present.landforms": [nativeSteps.landformClassification],
    },
    { requires: ["water.routing", "ocean.geography"], absent: ["Landforms"], inherited: true }
  ),
  physicalFeature(
    "physical.lifecycle",
    "Formation history",
    {
      "epoch.history": [
        nativeSteps.lithification,
        nativeSteps.rockMetamorphism,
        nativeSteps.physicalEpochHistory,
      ],
      "present.validation": [nativeSteps.physicalStructuralValidation],
    },
    { inherited: true, configuration: clockConfiguration }
  ),
];

function isRefinement(context?: FeatureContributionContext) {
  return Boolean(context && context.source.world.areas[context.input.areaId].profile !== "world");
}
