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
      regional: { kind: "captured" },
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
    { settings: ["plateDrift"], requires: ["physical.foundation"], regional: { kind: "captured" } }
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
      regional: {
        kind: "specialized",
        operations: { "terrain.refinement": ["refinement.relief"] },
      },
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
      regional: { kind: "captured" },
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
    {
      settings: ["impacts", "impactSize"],
      requires: ["physical.foundation"],
      absent: ["Impacts"],
      regional: { kind: "captured" },
    }
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
    { requires: ["physical.foundation"] }
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
    { requires: ["physical.foundation"], regional: { kind: "captured" } }
  ),
  physicalFeature(
    "physical.fractures",
    "Fault and fracture network",
    {
      "geology.fractures": [nativeSteps.fractureNetwork],
    },
    { requires: ["physical.foundation"], absent: ["Fractures"], regional: { kind: "captured" } }
  ),
  physicalFeature(
    "physical.geothermal",
    "Geothermal geography",
    {
      "geology.geothermal": [nativeSteps.geothermal],
    },
    {
      requires: ["physical.foundation"],
      absent: ["Geothermal"],
      regional: { kind: "captured" },
    }
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
    {
      requires: ["physical.foundation"],
      regional: {
        kind: "specialized",
        operations: {
          "climate.ocean": [
            "refinement.ocean",
            "refinement.ocean-memory",
            nativeSteps.oceanDistance,
            nativeSteps.bathymetry,
            nativeSteps.landmassesAndShelfGroups,
          ],
        },
      },
    }
  ),
  physicalFeature(
    "physical.ocean-circulation",
    "Ocean circulation and heat transport",
    {
      "climate.circulation": [nativeSteps.oceanCurrents, nativeSteps.warmthSources],
    },
    { requires: ["ocean.geography"], absent: ["OceanCurrents", "Warmth"] }
  ),
  physicalFeature(
    "physical.climate",
    "Climate",
    {
      "climate.atmosphere": [nativeSteps.atmosphericClimate],
    },
    {
      settings: [...climateSettings],
      regional: {
        kind: "specialized",
        operations: { "climate.atmosphere": ["refinement.climate"] },
      },
      requires: ["ocean.geography"],
    }
  ),
  physicalFeature(
    "water.routing",
    "Water balance and routing",
    {
      "water.runoff": [runoffStep],
      "water.routing": routingSteps,
      "water.groundwater": [nativeSteps.groundwater],
    },
    {
      regional: { kind: "specialized", operations: { "water.routing": ["refinement.water"] } },
      requires: ["physical.climate", "ocean.geography"],
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
    }
  ),
  physicalFeature(
    "physical.land-ice",
    "Land ice and meltwater",
    {
      "ice.model": [nativeSteps.landIceMassBalance, nativeSteps.iceFlow],
      "ice.flow": [nativeSteps.iceFlow],
      "ice.meltwater": [nativeSteps.glacialMeltwater],
    },
    {
      requires: ["physical.climate", "water.routing", "material.load-response"],
      absent: ["LandIce", "IceFlow", "GlacialMeltwater"],
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
    }
  ),
  physicalFeature(
    "physical.sea-ice",
    "Sea ice",
    {
      "ice.model": [nativeSteps.seaIce],
      "present.sea-ice": [nativeSteps.seaIce],
    },
    { requires: ["physical.climate", "ocean.geography"], absent: ["SeaIce"] }
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
    { requires: ["water.routing"], absent: ["RiverGeometry"] }
  ),
  physicalFeature(
    "physical.floodplains",
    "Floodplains",
    {
      "present.floodplains": [nativeSteps.riverFloodplains],
    },
    { requires: ["physical.river-networks"], absent: ["Floodplains"] }
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
    }
  ),
  physicalFeature(
    "physical.landforms",
    "Landform geography",
    {
      "present.landforms": [nativeSteps.landformClassification],
    },
    {
      requires: ["water.routing", "ocean.geography"],
      absent: ["Landforms"],
      regional: {
        kind: "specialized",
        operations: { "present.landforms": ["refinement.landforms"] },
      },
    }
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
    { configuration: clockConfiguration, regional: { kind: "captured" } }
  ),
];

function isRefinement(context?: FeatureContributionContext) {
  return Boolean(context && context.source.world.areas[context.input.areaId].profile !== "world");
}
