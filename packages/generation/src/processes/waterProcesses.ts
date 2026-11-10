import { riverChannelGeometry } from "../world/channelGeometry";
import { runoff } from "../world/climate";
import { deltaFormation } from "../world/deltas";
import { drainageConditioning } from "../world/drainageFlood";
import { floodplains } from "../world/floodplains";
import { drainageGuidance } from "../world/flowGuidance";
import { glacialMeltwater, glacialRunoff } from "../world/glacialEvolution";
import { glacialLandforms } from "../world/glacialLandforms";
import { iceFlow } from "../world/iceFlow";
import { landIce } from "../world/landIce";
import { landformClassification } from "../world/landforms";
import { validateChannels, validateDrainage, validateIce } from "../world/layerValidation";
import { lakeBasins } from "../world/lakes";
import { riverNetwork } from "../world/rivers";
import { flowRouting } from "../world/routing";
import { builder } from "./builder";
import { advanceGroundwater } from "../world/groundwater";

/** Where water and ice go, and the landforms read from what they did. They move no material. */
const ground = "Elevation",
  sea = "WaterKindCodes",
  targets = "FlowTargets",
  orders = "RiverOrders",
  channels = "RiverChannelOrders";
export const waterOff = builder({
  id: "runoff",
  statement: "What falls and is not lost to the air or the ground runs off.",
  needs: [sea, "Temperature", "Rainfall"],
  provides: ["Runoff"],
  build: runoff,
});
export const drainageFlood = builder({
  id: "drainage-conditioning",
  statement: "Every low place is filled in thought, so each cell has a way down to its outlet.",
  needs: [ground, sea],
  provides: ["DrainageElevations", "DrainageParents", "DrainageRanks"],
  build: drainageConditioning,
});
export const lakes = builder({
  id: "lake-basins",
  statement: "Low places hold what water they gather against what they lose, and spill if full.",
  needs: [ground, sea, "Runoff", "DrainageElevations"],
  provides: ["LakeOutletTargets", "LakeOverflow", sea, "WaterDepths", "WaterSurfaceElevations"],
  build: lakeBasins,
});
export const drainageTurns = builder({
  id: "drainage-guidance",
  statement: "Water's way across flat ground is settled by where it is heading.",
  needs: [ground, sea, "DrainageElevations"],
  provides: ["DrainageGuidanceTargets"],
  build: drainageGuidance,
});
export const routing = builder({
  id: "flow-routing",
  statement: "Each cell sends its water to one next cell, and basins follow from that.",
  needs: [sea, "DrainageParents", "DrainageGuidanceTargets"],
  provides: [targets, "FlowEdges", "DrainageBasinIds"],
  check: validateDrainage,
  build: flowRouting,
});
export const rivers = builder({
  id: "river-network",
  statement: "Water gathered down those routes makes rivers of the order it comes to.",
  needs: ["Runoff", targets],
  provides: [orders, "CatchmentArea", "FlowAccumulation"],
  build: riverNetwork,
});
export const channelForm = builder({
  id: "river-channel-geometry",
  statement: "A river is as wide and deep as what it carries.",
  needs: [ground, targets, orders],
  provides: ["RiverWidth", "RiverDepth", "RiverChannelStrength", channels],
  check: validateChannels,
  build: riverChannelGeometry,
});
export const floodplainForm = builder({
  id: "river-floodplains",
  statement: "Rivers spread over low ground that has taken what they deposited.",
  needs: [ground, targets, orders, channels],
  provides: ["FloodplainIntensity"],
  build: floodplains,
});
export const deltaForm = builder({
  id: "river-delta-formation",
  statement: "Rivers build deltas where what they bring outruns what waves take.",
  needs: [sea, targets, orders, channels],
  provides: ["DeltaIntensity"],
  build: deltaFormation,
});
export const iceBalance = builder({
  id: "land-ice-mass-balance",
  statement:
    "Ice piles up where more snow falls than melts, to what it can stand against spreading.",
  needs: [ground, sea, "Temperature", "Moisture", "Snowfall"],
  provides: ["IceThickness", "IceBalance", "MaximumIceThickness"],
  build: landIce,
});
export const iceSpread = builder({
  id: "ice-flow",
  statement: "Ice flows down its own surface, gathering what comes from upstream.",
  needs: [ground, sea, "IceThickness"],
  provides: ["IceFlux", "IceFlowTargets", "GroundedIce"],
  check: validateIce,
  build: iceFlow,
});
export const meltwater = builder({
  id: "glacial-meltwater",
  statement:
    "Ice gives up water by the warmth above it, the heat under it and how far it retreated.",
  needs: [sea, "Temperature", "IceThickness"],
  provides: ["GlacialMeltwater"],
  build: glacialMeltwater,
});
export const groundwater = builder({
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
  build: advanceGroundwater,
});
export const meltRunoff = builder({
  id: "glacial-runoff",
  statement: "What ice gave up joins what runs off the land.",
  needs: [sea, "Runoff"],
  provides: ["Runoff"],
  build: glacialRunoff,
});
export const iceLandforms = builder({
  id: "glacial-landforms",
  statement: "Ground ice has worked is read as valleys, cirques and moraines.",
  needs: [ground, sea],
  provides: ["LandformCodes"],
  build: glacialLandforms,
});
export const landforms = builder({
  id: "landform-classification",
  statement: "The rest of the ground is read as what its shape and its history make it.",
  needs: [ground, sea, orders],
  provides: ["LandformCodes", "Slope"],
  build: landformClassification,
});
