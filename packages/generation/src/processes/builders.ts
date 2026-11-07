import { plateAdvection } from "../canonry/advection";
import { glacialDeposition } from "../canonry/glacialEvolution";
import { continentalMarginEvolution, marineSedimentation } from "../canonry/continentalMargins";
import { coastalDetail } from "../canonry/coastalDetail";
import { externalCoastalForcing } from "../canonry/coastalEvolution";
import { tectonicUplift } from "../canonry/uplift";
import { impactCratering } from "../canonry/impacts";
import { orogenicConstruction } from "../canonry/orogeny";
import { sedimentTransport } from "../canonry/fluvial";
import { lithosphericFlexure } from "../canonry/support";
import { volcanicConstruction } from "../canonry/volcanism";
import { lithification } from "../rock/rockHistory";
import { defineProcess } from "./groundProcess";

/**
 * What builds and carries the land. Their bodies are long-lived and work on the whole field, so they
 * hold it directly; what they declare is what they mainly read and what they move, which puts them in
 * the table with the rest, and what they build goes through the ledger.
 */
export const plates = defineProcess({
  id: "plates",
  statement: "Plates carry everything on them, close oceans and collide.",
  reads: ["CrustMotionX", "CrustMotionY", "TectonicBoundaryCodes"],
  asks: [],
  moves: [["crust", "crust"]],
  settings: {},
  run: ({ world, context }) => plateAdvection(world, context),
});
export const mountains = defineProcess({
  id: "mountains",
  statement: "Where plates close, crust thickens over its roots and rock stands on it.",
  reads: ["TectonicBoundaryCodes", "TectonicStrain", "CrustRootReserve", "CrustThickness"],
  asks: [],
  moves: [["crust", "rock"]],
  settings: {},
  run: ({ world, context }) => orogenicConstruction(world, context),
});
export const volcanoes = defineProcess({
  id: "volcanoes",
  statement: "Plumes and sinking slabs melt rock that rises and builds volcanoes.",
  reads: ["OceanicSubduction", "CrustTypeCodes", "TectonicBoundaryPairIds"],
  asks: [],
  moves: [["melt", "rock"]],
  settings: {},
  run: ({ world, context }) => volcanicConstruction(world, context),
});
export const impacts = defineProcess({
  id: "impacts",
  statement: "What falls digs a crater, throws out what it dug and raises a rim.",
  reads: ["BedrockElevation"],
  asks: [],
  moves: [["rock", "space"]],
  settings: {},
  run: ({ world, context }) => impactCratering(world, context),
});
export const settling = defineProcess({
  id: "settling",
  statement: "The crust settles under what stands on it, and rises as that wears away.",
  reads: ["CrustSupportTarget", "CrustContinentalFraction"],
  asks: [],
  moves: [["crust", "crust"]],
  settings: {},
  run: ({ world, context }) => lithosphericFlexure(world, context),
});
export const riverLoad = defineProcess({
  id: "river-load",
  statement: "Rivers carry what their water and slope can, and drop what they cannot.",
  reads: ["CatchmentArea", "Slope", "FlowTargets", "SedimentSupply"],
  asks: [],
  moves: [
    ["load", "loose"],
    ["load", "sea"],
  ],
  settings: {},
  run: ({ world, context }) => sedimentTransport(world, context),
});
export const moraines = defineProcess({
  id: "moraines",
  statement: "Ice drops what it carries where it ends.",
  reads: ["IceFlowTargets", "SedimentSupply", "GroundedIce"],
  asks: [],
  moves: [["load", "loose"]],
  settings: {},
  run: ({ world, context }) => glacialDeposition(world, context),
});
export const seaFloor = defineProcess({
  id: "sea-floor",
  statement: "What rivers bring to the sea fills the room it has, nearest the margin first.",
  reads: ["Elevation", "MarginCodes"],
  asks: [],
  moves: [["sea", "loose"]],
  settings: {},
  run: ({ world, context }) => marineSedimentation(world, context),
});
export const margins = defineProcess({
  id: "margins",
  statement: "A continent's edge sags to the sea floor by what kind of margin it is.",
  reads: ["MarginCodes", "CrustContinentalFraction", "OceanMarginDistance"],
  asks: [],
  moves: [["crust", "crust"]],
  settings: {},
  run: ({ world }) => continentalMarginEvolution(world),
});
export const shoreDetail = defineProcess({
  id: "shore-detail",
  statement: "A new coast takes the small shape its kind of margin gives it.",
  reads: ["CoastalMarginCodes", "BedrockElevation"],
  asks: [],
  moves: [["crust", "rock"]],
  settings: {},
  run: ({ world, context }) => coastalDetail(world, context),
});
export const outsideWaves = defineProcess({
  id: "outside-waves",
  statement: "Waves a magic system raises wear the shore they reach.",
  reads: ["ExternalCoastalForcing", "WaterKindCodes"],
  asks: [],
  moves: [["rock", "load"]],
  settings: {},
  run: ({ world, context }) => externalCoastalForcing(world, context),
});
export const crustUplift = defineProcess({
  id: "crust-uplift",
  statement: "Crust takes its first thickness and height from what it is made of.",
  reads: ["CrustContinentalFraction", "CrustAssemblySeparation"],
  asks: [],
  moves: [["crust", "crust"]],
  settings: {},
  run: ({ world, context }) => tectonicUplift(world, context),
});
export const burial = defineProcess({
  id: "burial",
  statement: "Sediment buried under more of itself turns to rock of the kind its setting makes.",
  reads: ["SedimentThickness", "WaterKindCodes", "Temperature", "Rainfall"],
  asks: [],
  moves: [["loose", "rock"]],
  settings: {},
  run: ({ world }) => lithification(world),
});
