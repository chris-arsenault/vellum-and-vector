import { riverChannelGeometry } from "../water/channelGeometry";
import { waterYearFields } from "@atlas/domain";
import { runoff } from "../water/runoff";
import { atmosphere, oceanRead, currents, seaFloorZones } from "./climateProcesses";
import { landmasses } from "../world/geography";
import { deltaFormation } from "../world/deltas";
import { drainageConditioning } from "../water/drainageFlood";
import { floodplains } from "../world/floodplains";
import { drainageGuidance } from "../water/flowGuidance";
import { glacialMeltwater } from "../water/meltwater";
import { glacialLandforms } from "../world/glacialLandforms";
import { iceFlow } from "../world/iceFlow";
import { landIce } from "../world/landIce";
import { landformClassification } from "../world/landforms";
import { validateChannels, validateDrainage, validateIce } from "../world/layerValidation";
import { lakeBasins } from "../water/lakes";
import { riverNetwork } from "../water/rivers";
import { riverWarmth } from "../water/riverWarmth";
import { crustHeat } from "./crustProcesses";
import { flowRouting } from "../water/routing";
import { fieldCommand, fieldQuery } from "./builder";
import { advanceGroundwater } from "../water/groundwater";
import { validatePhysical } from "../world/validation";
import { respond } from "../coupling/answers";

/** Where water and ice go, and the landforms read from what they did. They move no material. */
const ground = "Elevation",
  sea = "WaterKindCodes",
  targets = "FlowTargets",
  orders = "RiverOrders",
  channels = "RiverChannelOrders";
export const waterOff = fieldQuery(
  {
    id: "runoff",
    statement: "What falls and is not lost to the air or the ground runs off.",
    needs: [sea, "Temperature", "Rainfall"],
    provides: [
      "Runoff",
      "FloodRunoff",
      "DryRunoff",
      "WaterRecharge",
      "SnowKept",
      "SoilWater",
      ...waterYearFields,
    ],
    asks: ["soilWetting", "soilWaterHeld"],
    execute: ({ map, context }) => runoff(map, context),
  },
  [oceanRead, atmosphere]
);
respond({
  key: "surfaceWater",
  by: "climate",
  reads: ["Runoff"],
  queries: [waterOff.operation],
  base: (map, i) => map.Runoff.get(i),
});
respond({
  key: "wetness",
  by: "climate",
  reads: ["Runoff"],
  queries: [waterOff.operation],
  base: (map, i, { Profile: p }) => map.Runoff.get(i) / (p.FluvialReferenceRunoff * 2),
});
export const drainageFlood = fieldQuery(
  {
    id: "drainage-conditioning",
    statement: "Every low place is filled in thought, so each cell has a way down to its outlet.",
    needs: [ground, sea],
    provides: ["DrainageElevations", "DrainageParents", "DrainageRanks"],
    execute: ({ map, context }) => drainageConditioning(map, context),
  },
  [oceanRead]
);
export const lakes = fieldQuery(
  {
    id: "lake-basins",
    statement: "Low places hold what water they gather against what they lose, and spill if full.",
    needs: [ground, sea, "Runoff", "DrainageElevations"],
    provides: ["LakeOutletTargets", "LakeOverflow", sea, "WaterDepths", "WaterSurfaceElevations"],
    execute: ({ map, context }) => lakeBasins(map, context),
  },
  [waterOff, drainageFlood]
);
export const landBodies = fieldQuery(
  {
    id: "landmasses-and-shelf-groups",
    statement: "Land is told apart into continents and islands, with the shelves that join them.",
    needs: [ground, sea],
    provides: ["LandmassIds", "LandmassClassCodes", "ContinentalGroupIds"],
    execute: ({ map, context }) => landmasses(map, context),
  },
  [lakes]
);
export const drainageTurns = fieldQuery(
  {
    id: "drainage-guidance",
    statement: "Water's way across flat ground is settled by where it is heading.",
    needs: [ground, sea, "DrainageElevations"],
    provides: ["DrainageGuidanceTargets"],
    execute: ({ map, context }) => drainageGuidance(map, context),
  },
  [lakes]
);
export const routing = fieldQuery(
  {
    id: "flow-routing",
    statement: "Each cell sends its water to one next cell, and basins follow from that.",
    needs: [sea, "DrainageParents", "DrainageGuidanceTargets"],
    provides: [targets, "FlowEdges", "DrainageBasinIds"],
    check: validateDrainage,
    execute: ({ map, context }) => flowRouting(map, context),
  },
  [drainageTurns]
);
export const rivers = fieldQuery(
  {
    id: "river-network",
    statement: "Water gathered down those routes makes rivers of the order it comes to.",
    needs: ["Runoff", targets],
    provides: [
      orders,
      "CatchmentArea",
      "FlowAccumulation",
      "FloodFlow",
      "PerennialFlow",
      "FlowingMonths",
      "RiverMemory",
    ],
    execute: ({ map, context }) => riverNetwork(map, context),
  },
  [waterOff, routing]
);
export const channelForm = fieldQuery(
  {
    id: "river-channel-geometry",
    statement: "A river is as wide and deep as what it carries.",
    needs: [ground, targets, orders],
    provides: ["RiverWidth", "RiverDepth", "RiverChannelStrength", channels],
    check: validateChannels,
    execute: ({ map, context }) => riverChannelGeometry(map, context),
  },
  [rivers]
);
export const riverHeat = fieldQuery(
  {
    id: "river-warmth",
    statement: "Heat entering current river routes travels downstream and fades with distance.",
    needs: [targets, orders],
    provides: ["RiverWarmth"],
    execute: ({ map }) => riverWarmth(map),
  },
  [rivers]
);
export const floodplainForm = fieldQuery(
  {
    id: "river-floodplains",
    statement: "Rivers spread over low ground that has taken what they deposited.",
    needs: [ground, targets, orders, channels],
    provides: ["FloodplainIntensity"],
    execute: ({ map, context }) => floodplains(map, context),
  },
  [channelForm]
);
export const deltaForm = fieldQuery(
  {
    id: "river-delta-formation",
    statement: "Rivers build deltas where what they bring outruns what waves take.",
    needs: [sea, targets, orders, channels],
    provides: ["DeltaIntensity"],
    execute: ({ map, context }) => deltaFormation(map, context),
  },
  [floodplainForm, currents, seaFloorZones]
);
export const iceBalance = fieldCommand(
  "work",
  {
    id: "land-ice-mass-balance",
    statement:
      "Ice piles up where more snow falls than melts, to what it can stand against spreading.",
    needs: [ground, sea, "Temperature", "Moisture", "Snowfall"],
    provides: ["IceThickness", "IceBalance", "MaximumIceThickness"],
    execute: ({ map, context }) => landIce(map, context),
  },
  [oceanRead, atmosphere, crustHeat]
);
export const iceSpread = fieldCommand(
  "work",
  {
    id: "ice-flow",
    statement: "Ice flows down its own surface, gathering what comes from upstream.",
    needs: [ground, sea, "IceThickness"],
    provides: ["IceFlux", "IceFlowTargets", "GroundedIce"],
    check: validateIce,
    execute: ({ map, context }) => iceFlow(map, context),
  },
  [oceanRead]
);
export const meltwater = fieldQuery(
  {
    id: "glacial-meltwater",
    statement:
      "Ice gives back the snow it was fed and the ice it lost, where it is warm and where it ends.",
    needs: [sea, "Temperature", "IceThickness", "SnowKept"],
    provides: ["GlacialMeltwater"],
    execute: ({ map, context }) => glacialMeltwater(map, context),
  },
  [oceanRead, atmosphere, crustHeat, waterOff]
);
export const groundwater = fieldCommand(
  "work",
  {
    id: "groundwater",
    statement:
      "Recharge enters permeable ground, follows hydraulic head and returns through springs.",
    needs: ["Rainfall", "Elevation", "WaterKindCodes"],
    provides: [
      "GroundwaterStorage",
      "GroundwaterExchangeVolume",
      "GroundwaterRecharge",
      "GroundwaterReturn",
      "GroundwaterOutflow",
      "GroundwaterTargets",
    ],
    execute: ({ map, context }) => advanceGroundwater(map, context),
  },
  [oceanRead, atmosphere]
);
export const iceLandforms = fieldQuery(
  {
    id: "glacial-landforms",
    statement: "Ground ice has worked is read as valleys, cirques and moraines.",
    needs: [ground, sea],
    provides: ["LandformCodes"],
    execute: ({ map, context }) => glacialLandforms(map, context),
  },
  [oceanRead, rivers]
);
export const landforms = fieldQuery(
  {
    id: "landform-classification",
    statement: "The rest of the ground is read as what its shape and its history make it.",
    needs: [ground, sea, orders],
    provides: ["LandformCodes", "Slope"],
    execute: ({ map, context }) => landformClassification(map, context),
  },
  [rivers, iceLandforms, deltaForm]
);

export const finalCheck = fieldQuery(
  {
    id: "physical-structural-validation",
    statement: "The finished world is checked to be one the rest of the atlas can use.",
    needs: [sea, targets],
    leaves: ["atlas:validated"],
    execute: ({ map, context }) => validatePhysical(map, context),
  },
  [routing]
);

/** Ice melting off the land sends its water down with the rain's. */
respond({
  key: "surfaceWater",
  by: "ice melt",
  reads: ["GlacialMeltwater"],
  queries: [meltwater.operation],
  add: (map, i) => (map.WaterKindCodes.get(i) === 1 ? 0 : map.GlacialMeltwater.get(i)),
});
