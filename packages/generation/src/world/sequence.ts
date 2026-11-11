import {
  burial,
  crustUplift,
  crustalRelaxation,
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
  atmosphere,
  currents,
  oceanBudget,
  oceanRead,
  oceanMemory,
  seaFloorZones,
  seaFreezing,
  shoreDistance,
  warmth,
} from "../processes/climateProcesses";
import { coast, outsideWaves } from "../processes/coast";
import { creep } from "../processes/creep";
import {
  baking,
  crustHeat,
  domains,
  epochActivity,
  epochRecord,
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
import { nativeOperation } from "../processes/processRunner";
import { slopes, slopesAfterStreams } from "../processes/slopes";
import { solution } from "../processes/solution";
import { streams } from "../processes/streams";
import {
  channelForm,
  landBodies,
  riverHeat,
  finalCheck,
  deltaForm,
  drainageFlood,
  drainageTurns,
  floodplainForm,
  iceBalance,
  iceLandforms,
  iceSpread,
  lakes,
  landforms,
  meltwater,
  groundwater,
  rivers,
  routing,
  waterOff,
} from "../processes/waterProcesses";
import { weathering } from "../processes/weathering";

export type NativeProcess = ReturnType<typeof nativeOperation>;
/** How a step's processes meet: in turn, or together on the same ground, sharing what they compete for. */
export interface StepOptions {
  readonly simultaneous: boolean;
  /** Optional inspection of the actual executable boundary, including failure. */
  readonly elapsed?: (milliseconds: number) => void;
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
export const step = (name: string, salt: number, ...processes: GroundProcess[]): NativeStep => [
  name,
  salt,
  nativeOperation(name, processes),
  processes,
];
/** A step whose processes compete for the same ground, and share what there is. */
export const stage = (name: string, salt: number, ...processes: GroundProcess[]): NativeStep => [
  name,
  salt,
  nativeOperation(name, processes, true),
  processes,
  { simultaneous: true },
];
/** Executable definitions. Feature operations choose their occurrences and order. */
export const nativeSteps = {
  crustalSupport: step("crustal-support", 0, support),
  crustalRelaxation: step("crustal-relaxation", 0, crustalRelaxation),
  lithosphericFlexure: step("lithospheric-flexure", 0, settling),
  oceanConnectivity: step("ocean-connectivity", 0, oceanBudget, oceanRead, oceanMemory),
  massWasting: step("mass-wasting", 0, slopes),
  continentalMarginEvolution: step("continental-margin-evolution", 0, margins),
  marineSedimentation: step("marine-sedimentation", 0, seaFloor),
  fractureNetwork: step("fracture-network", 0x6f9d2b1, fractures),
  geothermal: step("geothermal", 0x152b37, crustHeat),
  continentalSutures: step("continental-sutures", 0, sutures),
  tectonicMargins: step("tectonic-margins", 0, marginKinds),
  continentalDomains: step("continental-domains", 0x12e5a91, domains),
  tectonicUplift: step("tectonic-uplift", 0x4f2b17, crustUplift),
  tectonicProvinces: step("tectonic-provinces", 0x6b31e7, provinceLayout),
  orogenicConstruction: step("orogenic-construction", 0x7249d3, mountains),
  volcanicConstruction: step("volcanic-construction", 0x73a91d, volcanoes),
  impactCratering: step("impact-cratering", 0x4d73a1, impacts),
  landscapeInitialization: step("landscape-initialization", 0, firstLandscape),
  mantlePlumeRoots: step("mantle-plume-roots", 0x37c1, plumeRoots),
  coastalDetail: step("coastal-detail", 0x2ba7d1, shoreDetail),
  plateAdvection: step("plate-advection", 0, plates),
  tectonicEpochActivity: step("tectonic-epoch-activity", 0x1d71c3, epochActivity),
  landIceMassBalance: step("land-ice-mass-balance", 0, iceBalance),
  iceFlow: step("ice-flow", 0, iceSpread),
  glacialErosion: step("glacial-erosion", 0, ice),
  glacialDeposition: step("glacial-deposition", 0, moraines),
  glacialMeltwater: step("glacial-meltwater", 0, meltwater),
  groundwater: step("groundwater", 0, groundwater),
  externalCoastalForcing: step("external-coastal-forcing", 0, outsideWaves),
  coastalErosionAndDeposition: step("coastal-erosion-and-deposition", 0, coast),
  glacialLandforms: step("glacial-landforms", 0, iceLandforms),
  seaIce: step("sea-ice", 0, seaFreezing),
  landformClassification: step("landform-classification", 0, landforms),
  riverChannelGeometry: step("river-channel-geometry", 0, channelForm, riverHeat),
  riverFloodplains: step("river-floodplains", 0, floodplainForm),
  riverDeltaFormation: step("river-delta-formation", 0, deltaForm),
  oceanDistance: step("ocean-distance", 0, shoreDistance),
  bathymetry: step("bathymetry", 0, seaFloorZones),
  landmassesAndShelfGroups: step("landmasses-and-shelf-groups", 0, landBodies),
  oceanCurrents: step("ocean-currents", 0x6c41e2, currents),
  warmthSources: step("warmth-sources", 0x4a51c73, warmth),
  atmosphericClimate: step("atmospheric-climate", 0x4e28b3, atmosphere),
  runoff: step("runoff", 0, waterOff),
  drainageConditioning: step("drainage-conditioning", 0, drainageFlood),
  lakeBasins: step("lake-basins", 0x7a31, lakes),
  drainageGuidance: step("drainage-guidance", 0x61bd23, drainageTurns),
  flowRouting: step("flow-routing", 0, routing),
  riverNetwork: step("river-network", 0, rivers),
  ancestralFluvialErosion: stage(
    "ancestral-fluvial-erosion",
    0,
    weathering,
    streams,
    solution,
    creep
  ),
  postFluvialMassWasting: step("post-fluvial-mass-wasting", 0, slopesAfterStreams),
  sedimentTransport: step("sediment-transport", 0, riverLoad),
  lithification: step("lithification", 0, burial),
  rockMetamorphism: step("rock-metamorphism", 0, baking),
  physicalEpochHistory: step("physical-epoch-history", 0, epochRecord),
  physicalStructuralValidation: step("physical-structural-validation", 0, finalCheck),
};

/** Shared groups used by selected world features and regional erosion. */
export const runoffStep = nativeSteps.runoff;
export const routingSteps: readonly NativeStep[] = [
  nativeSteps.drainageConditioning,
  nativeSteps.lakeBasins,
  nativeSteps.drainageGuidance,
  nativeSteps.flowRouting,
  nativeSteps.riverNetwork,
];
export const drainageSteps: readonly NativeStep[] = [runoffStep, ...routingSteps];
export const incisionStage: readonly NativeStep[] = [nativeSteps.ancestralFluvialErosion];
export const incisionSteps: readonly NativeStep[] = [
  ...incisionStage,
  nativeSteps.postFluvialMassWasting,
];
export const sedimentStep = nativeSteps.sedimentTransport;
