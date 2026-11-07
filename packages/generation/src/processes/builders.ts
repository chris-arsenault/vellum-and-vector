import { plateAdvection } from "../world/advection";
import { glacialDeposition } from "../world/glacialEvolution";
import { continentalMarginEvolution, marineSedimentation } from "../world/continentalMargins";
import { coastalDetail } from "../world/coastalDetail";
import { tectonicUplift } from "../world/uplift";
import { impactCratering } from "../world/impacts";
import { orogenicConstruction } from "../world/orogeny";
import { sedimentTransport } from "../world/fluvial";
import { lithosphericFlexure } from "../world/support";
import { volcanicConstruction } from "../world/volcanism";
import type { PhysicalContext } from "../world/context";
import type { PhysicalBufferName, PhysicalField } from "../world/field";
import type { Pool } from "../coupling/flows";
import { lithification } from "../rock/rockHistory";
import reached from "./builderBands.generated.json" with { type: "json" };
import type { GroundProcess } from "./groundProcess";

/**
 * What builds and carries the land. Their bodies are long-lived and work on the whole field, so they
 * hold it directly, and what they read and write is what the code reaches: the architecture check works
 * that out from the program and fails if this list is out of date. What they build goes through the
 * ledger, and what they move is what they say here.
 */
const builder = (
  id: keyof typeof reached,
  statement: string,
  moves: readonly (readonly [Pool, Pool])[],
  build: (map: PhysicalField, context: PhysicalContext) => void
): GroundProcess => ({
  id,
  statement,
  reads: reached[id].reads as PhysicalBufferName[],
  writes: reached[id].writes as PhysicalBufferName[],
  asks: [],
  moves,
  settings: {},
  build,
});
export const plates = builder(
  "plates",
  "Plates carry everything on them, close oceans and collide.",
  [["crust", "crust"]],
  (map, context) => plateAdvection(map, context, context.AfterPlateStep)
);
export const mountains = builder(
  "mountains",
  "Where plates close, crust thickens over its roots and rock stands on it.",
  [["crust", "rock"]],
  (map, context) => orogenicConstruction(map, context)
);
export const volcanoes = builder(
  "volcanoes",
  "Plumes and sinking slabs melt rock that rises and builds volcanoes.",
  [["melt", "rock"]],
  (map, context) => volcanicConstruction(map, context)
);
export const impacts = builder(
  "impacts",
  "What falls digs a crater, throws out what it dug and raises a rim.",
  [["rock", "space"]],
  (map, context) => impactCratering(map, context)
);
export const settling = builder(
  "settling",
  "The crust settles under what stands on it, and rises as that wears away.",
  [["crust", "crust"]],
  (map, context) => lithosphericFlexure(map, context)
);
export const riverLoad = builder(
  "river-load",
  "Rivers carry what their water and slope can, and drop what they cannot.",
  [
    ["load", "loose"],
    ["load", "sea"],
  ],
  (map, context) => sedimentTransport(map, context)
);
export const moraines = builder(
  "moraines",
  "Ice drops what it carries where it ends.",
  [["load", "loose"]],
  (map, context) => glacialDeposition(map, context)
);
export const seaFloor = builder(
  "sea-floor",
  "What rivers bring to the sea fills the room it has, nearest the margin first.",
  [["sea", "loose"]],
  (map, context) => marineSedimentation(map, context)
);
export const margins = builder(
  "margins",
  "A continent's edge sags to the sea floor by what kind of margin it is.",
  [["crust", "crust"]],
  (map) => continentalMarginEvolution(map)
);
export const shoreDetail = builder(
  "shore-detail",
  "A new coast takes the small shape its kind of margin gives it.",
  [["crust", "rock"]],
  (map, context) => coastalDetail(map, context)
);
export const crustUplift = builder(
  "crust-uplift",
  "Crust takes its first thickness and height from what it is made of.",
  [["crust", "crust"]],
  (map, context) => tectonicUplift(map, context)
);
export const burial = builder(
  "burial",
  "Sediment buried under more of itself turns to rock of the kind its setting makes.",
  [["loose", "rock"]],
  (map) => lithification(map)
);
