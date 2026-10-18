// PhysicalGeographyEvolutionSession process order, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { oceanConnectivity } from "./ocean";
import { bathymetry, landmasses, oceanDistance } from "./geography";
import { oceanCurrents } from "./currents";
import { warmthSources } from "./warmth";
import { temperature, moisture, precipitation, runoff } from "./climate";
import { atmosphericFlow } from "./atmosphere";
import { drainageConditioning } from "./drainageFlood";
import { lakeBasins } from "./lakes";
import { drainageGuidance } from "./flowGuidance";
import { flowRouting } from "./routing";
import { riverNetwork } from "./rivers";
import { tectonicProvinces, continentalDomains } from "./provinces";
import { continentalSutures } from "./sutures";
import { tectonicMargins, tectonicEpoch } from "./margins";
import { tectonicUplift } from "./uplift";
import { initializeLandscape } from "./surface";
import { orogenicConstruction } from "./orogeny";
import { mantlePlumeRoots } from "./plumes";
import { volcanicConstruction } from "./volcanism";
import { impactCratering } from "./impacts";
import { massWasting } from "./massWasting";
import { crustalSupport, lithosphericFlexure } from "./support";
import { continentalMarginEvolution, marineSedimentation } from "./continentalMargins";
import { coastalDetail } from "./coastalDetail";
import { fractureNetwork } from "./fractures";
import { geothermal } from "./geothermal";
import { plateAdvection } from "./advection";
import { landIce } from "./landIce";
import { iceFlow } from "./iceFlow";
import { glacialDeposition, glacialErosion, glacialMeltwater } from "./glacialEvolution";
import { coastalErosion, externalCoastalForcing } from "./coastalEvolution";
import { seaIce } from "./seaIce";
import { glacialLandforms } from "./glacialLandforms";
import { landformClassification } from "./landforms";
import { riverChannelGeometry } from "./channelGeometry";
import { floodplains } from "./floodplains";
import { deltaFormation } from "./deltas";
import { fluvialErosion, sedimentTransport } from "./fluvial";
import { glacialRunoff } from "./glacialEvolution";
import { epochHistory, validatePhysical } from "./validation";

export type NativeProcess = (map: PhysicalField, context: PhysicalContext) => void;
export type NativeStep = readonly [name: string, salt: number, process: NativeProcess];
const support: NativeStep = ["crustal-support", 0, (map, c) => crustalSupport(map, c, false)];
const flexure: NativeStep = ["lithospheric-flexure", 0, lithosphericFlexure];
const ocean: NativeStep = ["ocean-connectivity", 0, oceanConnectivity];
const supportAndMargins: readonly NativeStep[] = [
  ["mass-wasting", 0, massWasting],
  support,
  flexure,
  ocean,
  ["continental-margin-evolution", 0, continentalMarginEvolution],
  ["marine-sedimentation", 0, marineSedimentation],
  support,
  flexure,
  ocean,
];
const thermal: readonly NativeStep[] = [
  ["fracture-network", 0x6f9d2b1, fractureNetwork],
  ["geothermal", 0x152b37, geothermal],
];
export const initialSteps: readonly NativeStep[] = [
  ["tectonic-provinces", 0x6b31e7, tectonicProvinces],
  ["continental-sutures", 0, continentalSutures],
  ["tectonic-margins", 0, tectonicMargins],
  ["continental-domains", 0x12e5a91, continentalDomains],
  ["tectonic-uplift", 0x4f2b17, tectonicUplift],
  ["landscape-initialization", 0, initializeLandscape],
  ["orogenic-construction", 0x7249d3, orogenicConstruction],
  ["mantle-plume-roots", 0x37c1, mantlePlumeRoots],
  ["volcanic-construction", 0x73a91d, volcanicConstruction],
  ["impact-cratering", 0x4d73a1, impactCratering],
  ...supportAndMargins,
  ["coastal-detail", 0x2ba7d1, coastalDetail],
  ocean,
  ...thermal,
];
export const geologySteps: readonly NativeStep[] = [
  ["plate-advection", 0, plateAdvection],
  ["tectonic-provinces", 0x6b31e7, tectonicProvinces],
  ["tectonic-epoch-activity", 0x1d71c3, tectonicEpoch],
  ["continental-sutures", 0, continentalSutures],
  ["tectonic-margins", 0, tectonicMargins],
  ["continental-domains", 0x12e5a91, continentalDomains],
  ["tectonic-uplift", 0x4f2b17, tectonicUplift],
  ["orogenic-construction", 0x7249d3, orogenicConstruction],
  ["volcanic-construction", 0x73a91d, volcanicConstruction],
  ["impact-cratering", 0x4d73a1, impactCratering],
  ...supportAndMargins,
  ...thermal,
];
export const glaciationSteps: readonly NativeStep[] = [
  ["land-ice-mass-balance", 0, landIce],
  ["ice-flow", 0, iceFlow],
  ["glacial-erosion", 0, glacialErosion],
  ["glacial-deposition", 0, glacialDeposition],
  ["crustal-support", 0, (map, c) => crustalSupport(map, c, true)],
  flexure,
];
export const iceSteps: readonly NativeStep[] = [
  ["land-ice-mass-balance", 0, landIce],
  ["ice-flow", 0, iceFlow],
];
export const meltwaterStep: NativeStep = ["glacial-meltwater", 0, glacialMeltwater];
export const coastalSteps: readonly NativeStep[] = [
  ["external-coastal-forcing", 0, externalCoastalForcing],
  ["coastal-erosion-and-deposition", 0, coastalErosion],
];
export const extractionSteps: readonly NativeStep[] = [
  ["glacial-landforms", 0, glacialLandforms],
  ["sea-ice", 0, seaIce],
  ["landform-classification", 0, landformClassification],
  ["river-channel-geometry", 0, riverChannelGeometry],
  ["river-floodplains", 0, floodplains],
  ["river-delta-formation", 0, deltaFormation],
];
export const climateSteps: readonly NativeStep[] = [
  ["ocean-connectivity", 0, oceanConnectivity],
  ["ocean-distance", 0, oceanDistance],
  ["bathymetry", 0, bathymetry],
  ["landmasses-and-shelf-groups", 0, landmasses],
  ["ocean-currents", 0x6c41e2, oceanCurrents],
  ["warmth-sources", 0x4a51c73, warmthSources],
  ["temperature", 0, temperature],
  ["atmospheric-flow", 0x4e28b3, atmosphericFlow],
  ["moisture-transport", 0x5e29, moisture],
  ["precipitation", 0x3b7d19, precipitation],
];
export const drainageSteps: readonly NativeStep[] = [
  ["runoff", 0, runoff],
  ["drainage-conditioning", 0, drainageConditioning],
  ["lake-basins", 0x7a31, lakeBasins],
  ["drainage-guidance", 0x61bd23, drainageGuidance],
  ["flow-routing", 0, flowRouting],
  ["river-network", 0, riverNetwork],
];
export const incisionSteps: readonly NativeStep[] = [
  ["ancestral-fluvial-erosion", 0, fluvialErosion],
  ["post-fluvial-mass-wasting", 0, (map, c) => massWasting(map, c, true)],
];
export const sedimentStep: NativeStep = ["sediment-transport", 0, sedimentTransport];
export const glacialRunoffStep: NativeStep = ["glacial-runoff", 0, glacialRunoff];
export const historyStep: NativeStep = ["physical-epoch-history", 0, epochHistory];
export const validationStep: NativeStep = ["physical-structural-validation", 0, validatePhysical];
