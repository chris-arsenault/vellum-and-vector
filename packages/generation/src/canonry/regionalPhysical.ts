import { spatial } from "@atlas/domain";
import type { GenerationState, MapProcess } from "../process";
import { generationBindings } from "../generationBindings";
import { physicalContext } from "./context";
import { synthesizeRegionalRelief } from "./adaptiveRelief";
import { parentChannels, composeNativeAuthoring } from "./atlasWorkspace";
import { regionalIncomingWater } from "./regionalCorridors";
import { oceanConnectivity } from "./ocean";
import { oceanDistance, bathymetry, landmasses } from "./geography";
import { drainageConditioning } from "./drainageFlood";
import { lakeBasins } from "./lakes";
import { drainageGuidance } from "./flowGuidance";
import { flowRouting } from "./routing";
import { riverNetwork } from "./rivers";
import { landformClassification } from "./landforms";
import { riverChannelGeometry } from "./channelGeometry";
import { floodplains } from "./floodplains";
import { deltaFormation } from "./deltas";
import { validatePhysical } from "./validation";
import { maintainLandmark } from "./landmarks";
import { refreshGrounding } from "./glacierSurface";
import { generationResolution } from "../resolution";

export function constructRegionalRelief(state: GenerationState, seed: number) {
  const work = state.physical!,
    parent = parentChannels(state).get("elevation"),
    c = physicalContext(seed, 0, work.profile);
  oceanConnectivity(work.map, c);
  if (parent) synthesizeRegionalRelief(work.map, parent, seed, work.profile);
  composeNativeAuthoring(work);
}
function maintainInheritedLandmarks(state: GenerationState) {
  const work = state.physical!,
    world = state.domain.world,
    epoch = Math.max(0, world.epochs.length - 1);
  work.landmarks = new Map();
  for (const landmark of world.landmarks) {
    if (!spatial.intersects(landmark.geometry, state.domain.scope.footprint)) continue;
    maintainLandmark(work.map, work.profile, landmark, epoch, work.landmarks, [], {
      world,
      magic: work.magic,
      scope: state.domain.scope,
      activity: () => 1,
    });
  }
  composeNativeAuthoring(work);
}
export function constructRegionalWater(state: GenerationState, seed: number) {
  const work = state.physical!,
    map = work.map,
    // Resolve catchments at the regional map's scale, rather than requiring a World river.
    // Discharge scales with catchment area; reach length scales with linear resolution.
    scale = Math.min(
      1,
      (state.domain.scope.resolution ?? map.mesh.spacing) /
        generationResolution("standard").cellSpan
    ),
    p = work.profile,
    c = physicalContext(seed, 0, {
      ...p,
      RiverAccumulationThreshold: p.RiverAccumulationThreshold * scale ** 2,
      RiverMinimumAccumulationThreshold: p.RiverMinimumAccumulationThreshold * scale ** 2,
      RiverMinimumBasinDischarge: p.RiverMinimumBasinDischarge * scale ** 2,
      MinimumRiverReachLength: p.MinimumRiverReachLength * scale,
    }),
    incoming = regionalIncomingWater(state);
  const route = () => {
    oceanConnectivity(map, c);
    oceanDistance(map);
    bathymetry(map, c);
    landmasses(map, c);
    drainageConditioning(map, c);
    lakeBasins(map, c, incoming);
    drainageGuidance(map, c);
    flowRouting(map, c);
    riverNetwork(map, c, incoming);
  };
  route();
  maintainInheritedLandmarks(state);
  if (work.landmarks!.size) route();
  landformClassification(map, c);
  riverChannelGeometry(map, c);
  floodplains(map, c);
  deltaFormation(map, c);
  refreshGrounding(map, work.profile);
  validatePhysical(map, c);
}
const waterFacts = [
  "Ocean",
  "OceanDistance",
  "Bathymetry",
  "Landmasses",
  "Runoff",
  "Lakes",
  "LakeOutlets",
  "DrainageGuidance",
  "FlowRouting",
  "Rivers",
  "Landforms",
  "Validated",
];
const regionalPasses: [string, typeof constructRegionalRelief, string[], string[]][] = [
  ["relief", constructRegionalRelief, ["canonry:Elevation"], []],
  [
    "water",
    constructRegionalWater,
    ["canonry:Elevation"],
    waterFacts.map((fact) => `canonry:${fact}`),
  ],
];
export const regionalPhysicalProcesses: MapProcess[] = regionalPasses.map(
  ([name, operation, requires, produces]) => ({
    contract: {
      id: `regional.${name}`,
      version: "1",
      parameters: {},
      requires: ["canonry:workspace", ...requires],
      produces,
      invalidates: [],
      workspaceOnly: true,
    },
    behavior: {
      kind: "model-pass",
      applyPass(state, context) {
        operation(state, generationBindings(context).seed);
      },
    },
    validate: () => [],
  })
);
