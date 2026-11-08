import { plateAdvection } from "../world/advection";
import { glacialDeposition } from "../world/glacialEvolution";
import { continentalMarginEvolution, marineSedimentation } from "../world/continentalMargins";
import { coastalDetail } from "../world/coastalDetail";
import { tectonicUplift } from "../world/uplift";
import { impactCratering } from "../world/impacts";
import { orogenicConstruction, relaxOrogenicCrust } from "../world/orogeny";
import { sedimentTransport } from "../world/fluvial";
import { lithosphericFlexure } from "../world/support";
import { volcanicConstruction } from "../world/volcanism";
import { lithification } from "../rock/rockHistory";
import { builder } from "./builder";

/** What builds and carries the land, moving material through the ledger as it says here. */
const provinces = "CrustProvinceIds",
  sea = "WaterKindCodes",
  ground = "Elevation",
  bedrock = "BedrockElevation",
  rock = "RockKindCodes",
  loose = "SedimentThickness";
export const plates = builder({
  id: "plates",
  statement: "Plates carry everything on them, close oceans and collide.",
  needs: [provinces, rock],
  provides: [ground, bedrock, "CrustThickness", "CrustPlateIds", provinces],
  moves: [["crust", "crust"]],
  build: (map, context) => plateAdvection(map, context, context.AfterPlateStep),
});
export const mountains = builder({
  id: "mountains",
  statement: "Where plates close, crust thickens over its roots and rock stands on it.",
  needs: [ground, provinces, rock],
  provides: [ground, bedrock, "CrustThickness", "OrogenicConstruction"],
  moves: [["crust", "rock"]],
  build: (map, context) => orogenicConstruction(map, context),
});
export const crustalRelaxation = builder({
  id: "crustal-relaxation",
  statement: "Thick and heavily loaded continental crust spreads after compression releases it.",
  needs: ["CrustThickness", provinces],
  provides: ["CrustThickness"],
  moves: [["crust", "crust"]],
  build: relaxOrogenicCrust,
});
export const volcanoes = builder({
  id: "volcanoes",
  statement: "Plumes and sinking slabs melt rock that rises and builds volcanoes.",
  needs: [ground, rock],
  provides: [
    ground,
    bedrock,
    "VolcanicConstructionHistory",
    "VolcanicMeltSupply",
    "VolcanicActivity",
    "FractureConductance",
  ],
  moves: [["melt", "rock"]],
  build: (map, context) => volcanicConstruction(map, context),
});
export const impacts = builder({
  id: "impacts",
  statement: "What falls digs a crater, throws out what it dug and raises a rim.",
  needs: [ground, rock],
  provides: [ground, bedrock, "SedimentSupply", "ImpactExcavation", "FractureConductance"],
  moves: [
    ["rock", "space"],
    ["space", "rock"],
    ["space", "loose"],
  ],
  build: (map, context) => impactCratering(map, context),
});
export const settling = builder({
  id: "settling",
  statement: "The crust settles under what stands on it, and rises as that wears away.",
  needs: ["CrustSupportTarget"],
  provides: [ground, bedrock, "CrustSupportElevation"],
  moves: [["crust", "crust"]],
  build: (map, context) => lithosphericFlexure(map, context),
});
export const riverLoad = builder({
  id: "river-load",
  statement: "Rivers carry what their water and slope can, and drop what they cannot.",
  needs: [ground, "FlowTargets", "CatchmentArea"],
  provides: [ground, loose, "CumulativeDeposition"],
  moves: [
    ["load", "loose"],
    ["load", "sea"],
  ],
  asks: ["discharge", "looseSupply", "loadCapacity"],
  build: (map, context) => sedimentTransport(map, context),
});
export const moraines = builder({
  id: "moraines",
  statement: "Ice drops what it carries where it ends.",
  needs: [ground, "IceFlowTargets", "IceFlux"],
  provides: [ground, loose, "CumulativeGlacialDeposition"],
  moves: [
    ["load", "loose"],
    ["load", "sea"],
  ],
  build: (map, context) => glacialDeposition(map, context),
});
export const seaFloor = builder({
  id: "sea-floor",
  statement: "What rivers bring to the sea fills the room it has, nearest the margin first.",
  needs: [ground, sea, "OceanMarginDistance"],
  provides: [ground, loose, "CumulativeDeposition"],
  moves: [["sea", "loose"]],
  build: (map, context) => marineSedimentation(map, context),
});
export const margins = builder({
  id: "margins",
  statement: "A continent's edge sags to the sea floor by what kind of margin it is.",
  needs: [ground, sea, "MarginCodes"],
  provides: [ground, bedrock, "CoastalMarginCodes", "OceanMarginDistance"],
  moves: [["crust", "crust"]],
  build: (map) => continentalMarginEvolution(map),
});
export const shoreDetail = builder({
  id: "shore-detail",
  statement: "A new coast takes the small shape its kind of margin gives it.",
  needs: [ground, "MarginCodes"],
  provides: [ground, bedrock],
  moves: [["crust", "crust"]],
  build: (map, context) => coastalDetail(map, context),
});
export const crustUplift = builder({
  id: "crust-uplift",
  statement: "Crust takes its first thickness and height from what it is made of.",
  needs: [provinces, "ContinentalPotential"],
  provides: [ground, bedrock, "CrustThickness"],
  moves: [["crust", "crust"]],
  build: (map, context) => tectonicUplift(map, context),
});
export const burial = builder({
  id: "burial",
  statement:
    "Sediment buried under more of itself turns to rock of the kind its setting makes, and water with no way out dries to salt.",
  needs: [ground, rock],
  provides: [rock, bedrock],
  moves: [
    ["loose", "rock"],
    ["sea", "rock"],
  ],
  build: (map, context) => lithification(map, context.Span),
});
