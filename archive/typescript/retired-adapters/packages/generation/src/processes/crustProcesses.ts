import { fractureNetwork } from "../world/fractures";
import { geothermal } from "../world/geothermal";
import { tectonicEpoch, tectonicMargins } from "../world/margins";
import { mantlePlumeRoots } from "../world/plumes";
import { continentalDomains, tectonicProvinces } from "../world/provinces";
import { crustalSupport } from "../world/support";
import { initializeLandscape } from "../rock/groundInitialization";
import { continentalSutures } from "../world/sutures";
import { epochHistory } from "../world/validation";
import { initializeRock, metamorphism } from "../rock/rockHistory";
import { fieldCommand, fieldQuery } from "./builder";

/** What sets up the crust and its history: none of it moves material. */
const provinces = "CrustProvinceIds",
  boundaries = "TectonicBoundaryCodes",
  fraction = "CrustContinentalFraction";
export const provinceLayout = fieldCommand(
  "initialize",
  {
    id: "tectonic-provinces",
    statement: "The crust is cut into provinces on plates, and where plates meet is worked out.",
    provides: [
      provinces,
      "CrustPlateIds",
      fraction,
      "CrustMotionX",
      "CrustMotionY",
      boundaries,
      "InitialTectonicBoundaryCodes",
      "TectonicStrain",
    ],
    execute: ({ map, context }) => tectonicProvinces(map, context),
  },
  []
);
export const epochActivity = fieldCommand(
  "event",
  {
    id: "tectonic-epoch-activity",
    statement: "An epoch's tectonic strength sets how hard plate boundaries work in it.",
    needs: ["InitialTectonicBoundaryCodes"],
    provides: [boundaries, "TectonicStrain"],
    execute: ({ map }) => tectonicEpoch(map),
  },
  []
);
export const sutures = fieldCommand(
  "work",
  {
    id: "continental-sutures",
    statement: "Where continents have collided, the seam is remembered as weak ground.",
    needs: [boundaries, fraction],
    provides: ["CrustSutureStrength", "CrustCollisionIntensity"],
    execute: ({ map, context }) => continentalSutures(map, context),
  },
  []
);
export const marginKinds = fieldCommand(
  "event",
  {
    id: "tectonic-margins",
    statement: "Each continental margin is active or passive by what its plate boundary is doing.",
    needs: [boundaries, fraction],
    provides: ["MarginCodes", "CrustAge"],
    execute: ({ map, context }) => tectonicMargins(map, context),
  },
  []
);
export const domains = fieldQuery(
  {
    id: "continental-domains",
    statement: "The stable ground of each continent is told from what its boundaries have worked.",
    needs: [boundaries],
    provides: ["ContinentalPotential"],
    execute: ({ map, context }) => continentalDomains(map, context),
  },
  []
);
export const firstLandscape = fieldCommand(
  "initialize",
  {
    id: "landscape-initialization",
    statement: "The first ground takes its height and the rock its crust is made of.",
    needs: [provinces],
    provides: ["RockKindCodes", "RockResistance", "CrustSupportElevation", "BedrockElevation"],
    execute({ map, context }) {
      initializeLandscape(map);
      initializeRock(map, context);
    },
  },
  []
);
export const plumeRoots = fieldCommand(
  "initialize",
  {
    id: "mantle-plume-roots",
    statement:
      "Plumes rise from fixed places in the mantle, wherever the plates then carry things.",
    needs: [provinces],
    provides: ["MantlePlumeRootStrength"],
    execute: ({ map, context }) => mantlePlumeRoots(map, context),
  },
  []
);
export const fractures = fieldCommand(
  "work",
  {
    id: "fracture-network",
    statement: "Strain breaks the ground along faults that water and heat can follow.",
    needs: ["TectonicStrain"],
    provides: ["FractureConductance"],
    execute: ({ map, context }) => fractureNetwork(map, context),
  },
  []
);
export const crustHeat = fieldQuery(
  {
    id: "geothermal",
    statement:
      "Heat reaches the surface where boundaries, fractures, volcanoes and impacts let it.",
    needs: [boundaries, "FractureConductance"],
    provides: ["Geothermal", "HeatSourceDensity"],
    execute: ({ map, context }) => geothermal(map, context),
  },
  []
);
export const support = fieldQuery(
  {
    id: "crustal-support",
    statement: "Each column finds the height it floats at under its crust, rock, sediment and ice.",
    needs: ["CrustThickness"],
    provides: ["CrustSupportTarget"],
    execute: ({ map, context }) => crustalSupport(map, context),
  },
  []
);
export const baking = fieldCommand(
  "work",
  {
    id: "rock-metamorphism",
    statement: "Rock buried under what a belt built is baked into its harder form.",
    needs: ["RockResistance"],
    provides: ["RockKindCodes", "RockResistance"],
    asks: ["heat"],
    execute: ({ map, context }) => metamorphism(map, context),
  },
  []
);
export const epochRecord = fieldCommand(
  "event",
  {
    id: "physical-epoch-history",
    statement: "What an epoch left is kept, so later epochs and reports can read it.",
    needs: ["Elevation"],
    provides: ["FirstEpochHeight"],
    execute: ({ map, context }) => epochHistory(map, context),
  },
  []
);
