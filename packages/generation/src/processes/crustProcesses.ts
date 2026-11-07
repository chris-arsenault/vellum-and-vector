import { fractureNetwork } from "../world/fractures";
import { geothermal } from "../world/geothermal";
import { tectonicEpoch, tectonicMargins } from "../world/margins";
import { mantlePlumeRoots } from "../world/plumes";
import { continentalDomains, tectonicProvinces } from "../world/provinces";
import { crustalSupport } from "../world/support";
import { initializeLandscape } from "../world/surface";
import { continentalSutures } from "../world/sutures";
import { epochHistory, validatePhysical } from "../world/validation";
import { initializeRock, metamorphism } from "../rock/rockHistory";
import { builder } from "./builder";

/** What sets up the crust and its history: none of it moves material. */
const provinces = "CrustProvinceIds",
  boundaries = "TectonicBoundaryCodes",
  fraction = "CrustContinentalFraction";
export const provinceLayout = builder({
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
  build: tectonicProvinces,
});
export const epochActivity = builder({
  id: "tectonic-epoch-activity",
  statement: "An epoch's tectonic strength sets how hard plate boundaries work in it.",
  needs: ["InitialTectonicBoundaryCodes"],
  provides: [boundaries, "TectonicStrain"],
  build: tectonicEpoch,
});
export const sutures = builder({
  id: "continental-sutures",
  statement: "Where continents have collided, the seam is remembered as weak ground.",
  needs: [boundaries, fraction],
  provides: ["CrustSutureStrength", "CrustCollisionIntensity"],
  build: continentalSutures,
});
export const marginKinds = builder({
  id: "tectonic-margins",
  statement: "Each continental margin is active or passive by what its plate boundary is doing.",
  needs: [boundaries, fraction],
  provides: ["MarginCodes", "CrustAge"],
  build: tectonicMargins,
});
export const domains = builder({
  id: "continental-domains",
  statement: "The stable ground of each continent is told from what its boundaries have worked.",
  needs: [boundaries],
  provides: ["ContinentalPotential"],
  build: continentalDomains,
});
export const firstLandscape = builder({
  id: "landscape-initialization",
  statement: "The first ground takes its height and the rock its crust is made of.",
  needs: [provinces],
  provides: ["RockKindCodes", "RockResistance", "CrustSupportElevation", "BedrockElevation"],
  build(map, context) {
    initializeLandscape(map);
    initializeRock(map, context);
  },
});
export const plumeRoots = builder({
  id: "mantle-plume-roots",
  statement: "Plumes rise from fixed places in the mantle, wherever the plates then carry things.",
  needs: [provinces],
  provides: ["MantlePlumeRootStrength"],
  build: mantlePlumeRoots,
});
export const fractures = builder({
  id: "fracture-network",
  statement: "Strain breaks the ground along faults that water and heat can follow.",
  needs: ["TectonicStrain"],
  provides: ["FractureConductance"],
  build: fractureNetwork,
});
export const crustHeat = builder({
  id: "geothermal",
  statement: "Heat reaches the surface where boundaries, fractures, volcanoes and impacts let it.",
  needs: [boundaries, "FractureConductance"],
  provides: ["Geothermal", "HeatSourceDensity"],
  build: geothermal,
});
export const support = builder({
  id: "crustal-support",
  statement: "Each column finds the height it floats at under its crust, rock, sediment and ice.",
  needs: ["CrustThickness"],
  provides: ["CrustSupportTarget"],
  build: (map, context) => crustalSupport(map, context, Boolean(context.IceLoad)),
});
export const baking = builder({
  id: "rock-metamorphism",
  statement: "Rock buried under what a belt built is baked into its harder form.",
  needs: ["RockResistance"],
  provides: ["RockKindCodes", "RockResistance"],
  asks: ["heat"],
  build: metamorphism,
});
export const epochRecord = builder({
  id: "physical-epoch-history",
  statement: "What an epoch left is kept, so later epochs and reports can read it.",
  needs: ["Elevation"],
  provides: ["FirstEpochHeight"],
  build: epochHistory,
});
export const finalCheck = builder({
  id: "physical-structural-validation",
  statement: "The finished world is checked to be one the rest of the atlas can use.",
  needs: ["WaterKindCodes", "FlowTargets"],
  leaves: ["atlas:validated"],
  build: validatePhysical,
});
