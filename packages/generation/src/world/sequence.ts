import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import {
  burial,
  crustUplift,
  impacts,
  margins,
  moraines,
  mountains,
  plates,
  riverLoad,
  seaFloor,
  settling,
  shoreDetail,
  volcanoes,
} from "../processes/builders";
import {
  airMoisture,
  airTemperature,
  currents,
  landBodies,
  oceanFill,
  rainfall,
  seaFloorZones,
  seaFreezing,
  shoreDistance,
  warmth,
  winds,
} from "../processes/climateProcesses";
import { coast, outsideWaves } from "../processes/coast";
import { creep } from "../processes/creep";
import {
  baking,
  crustHeat,
  domains,
  epochActivity,
  epochRecord,
  finalCheck,
  firstLandscape,
  fractures,
  marginKinds,
  plumeRoots,
  provinceLayout,
  support,
  sutures,
} from "../processes/crustProcesses";
import type { GroundProcess } from "../processes/groundProcess";
import { ice } from "../processes/ice";
import { actBy, actTogether } from "../processes/processCatalogue";
import { slopes, slopesAfterStreams } from "../processes/slopes";
import { solution } from "../processes/solution";
import { streams } from "../processes/streams";
import {
  channelForm,
  deltaForm,
  drainageFlood,
  drainageTurns,
  floodplainForm,
  iceBalance,
  iceLandforms,
  iceSpread,
  lakes,
  landforms,
  meltRunoff,
  meltwater,
  rivers,
  routing,
  waterOff,
} from "../processes/waterProcesses";
import { weathering } from "../processes/weathering";

export type NativeProcess = (map: PhysicalField, context: PhysicalContext) => void;
/** How a step's processes meet: in turn, or together on the same ground, sharing what they compete for. */
export interface StepOptions {
  readonly simultaneous: boolean;
}
/** A named step of a world's history: its seed salt, how it runs, and the processes it runs. */
export type NativeStep = readonly [
  name: string,
  salt: number,
  process: NativeProcess,
  processes: readonly GroundProcess[],
  options?: StepOptions,
];
/** A step whose processes run in turn, as order is physics. */
const step = (name: string, salt: number, ...processes: GroundProcess[]): NativeStep => [
  name,
  salt,
  actBy(...processes),
  processes,
];
/** A step whose processes compete for the same ground, and share what there is. */
const stage = (name: string, salt: number, ...processes: GroundProcess[]): NativeStep => [
  name,
  salt,
  actTogether(...processes),
  processes,
  { simultaneous: true },
];
const supportStep = step("crustal-support", 0, support);
const flexure = step("lithospheric-flexure", 0, settling);
const ocean = step("ocean-connectivity", 0, oceanFill);
const supportAndMargins: readonly NativeStep[] = [
  step("mass-wasting", 0, slopes),
  supportStep,
  flexure,
  ocean,
  step("continental-margin-evolution", 0, margins),
  step("marine-sedimentation", 0, seaFloor),
  supportStep,
  flexure,
  ocean,
];
const thermal: readonly NativeStep[] = [
  step("fracture-network", 0x6f9d2b1, fractures),
  step("geothermal", 0x152b37, crustHeat),
];
const crustSetup: readonly NativeStep[] = [
  step("continental-sutures", 0, sutures),
  step("tectonic-margins", 0, marginKinds),
  step("continental-domains", 0x12e5a91, domains),
  step("tectonic-uplift", 0x4f2b17, crustUplift),
];
const provinceStep = step("tectonic-provinces", 0x6b31e7, provinceLayout);
const buildingSteps: readonly NativeStep[] = [step("orogenic-construction", 0x7249d3, mountains)];
const volcanoStep = step("volcanic-construction", 0x73a91d, volcanoes);
const impactStep = step("impact-cratering", 0x4d73a1, impacts);
export const initialSteps: readonly NativeStep[] = [
  provinceStep,
  ...crustSetup,
  step("landscape-initialization", 0, firstLandscape),
  ...buildingSteps,
  step("mantle-plume-roots", 0x37c1, plumeRoots),
  volcanoStep,
  impactStep,
  ...supportAndMargins,
  step("coastal-detail", 0x2ba7d1, shoreDetail),
  ocean,
  ...thermal,
];
export const geologySteps: readonly NativeStep[] = [
  step("plate-advection", 0, plates),
  provinceStep,
  step("tectonic-epoch-activity", 0x1d71c3, epochActivity),
  ...crustSetup,
  ...buildingSteps,
  volcanoStep,
  impactStep,
  ...supportAndMargins,
  ...thermal,
];
export const iceSteps: readonly NativeStep[] = [
  step("land-ice-mass-balance", 0, iceBalance),
  step("ice-flow", 0, iceSpread),
];
export const glaciationSteps: readonly NativeStep[] = [
  ...iceSteps,
  step("glacial-erosion", 0, ice),
  step("glacial-deposition", 0, moraines),
  // The schedule runs this one under ice; the product says so through the step's ice-load parameter.
  [
    "crustal-support",
    0,
    (map, context) => supportStep[2](map, { ...context, IceLoad: true }),
    [support],
  ],
  flexure,
];
export const meltwaterStep = step("glacial-meltwater", 0, meltwater);
export const coastalSteps: readonly NativeStep[] = [
  step("external-coastal-forcing", 0, outsideWaves),
  step("coastal-erosion-and-deposition", 0, coast),
];
export const extractionSteps: readonly NativeStep[] = [
  step("glacial-landforms", 0, iceLandforms),
  step("sea-ice", 0, seaFreezing),
  step("landform-classification", 0, landforms),
  step("river-channel-geometry", 0, channelForm),
  step("river-floodplains", 0, floodplainForm),
  step("river-delta-formation", 0, deltaForm),
];
export const climateSteps: readonly NativeStep[] = [
  ocean,
  step("ocean-distance", 0, shoreDistance),
  step("bathymetry", 0, seaFloorZones),
  step("landmasses-and-shelf-groups", 0, landBodies),
  step("ocean-currents", 0x6c41e2, currents),
  step("warmth-sources", 0x4a51c73, warmth),
  step("temperature", 0, airTemperature),
  step("atmospheric-flow", 0x4e28b3, winds),
  step("moisture-transport", 0x5e29, airMoisture),
  step("precipitation", 0x3b7d19, rainfall),
];
export const drainageSteps: readonly NativeStep[] = [
  step("runoff", 0, waterOff),
  step("drainage-conditioning", 0, drainageFlood),
  step("lake-basins", 0x7a31, lakes),
  step("drainage-guidance", 0x61bd23, drainageTurns),
  step("flow-routing", 0, routing),
  step("river-network", 0, rivers),
];
export const incisionSteps: readonly NativeStep[] = [
  // Rivers and creeping cover take from the same loose ground, so they share it where it runs short.
  stage("ancestral-fluvial-erosion", 0, weathering, streams, solution, creep),
  step("post-fluvial-mass-wasting", 0, slopesAfterStreams),
];
export const sedimentStep = step("sediment-transport", 0, riverLoad);
export const glacialRunoffStep = step("glacial-runoff", 0, meltRunoff);
export const rockSteps: readonly NativeStep[] = [
  step("lithification", 0, burial),
  step("rock-metamorphism", 0, baking),
];
export const historyStep = step("physical-epoch-history", 0, epochRecord);
export const validationStep = step("physical-structural-validation", 0, finalCheck);
