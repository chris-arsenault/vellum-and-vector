import {
  prepareAdaptiveTransfer,
  isNumericalVector,
  type AdaptiveTopology,
  type NumericalVector,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { joinAdaptiveSeam } from "./adaptiveSeam";
import { createField, type PhysicalField } from "./field";
import { reconcileRemeshedWater } from "./remeshWater";
import { remeshLandmarkDrainage } from "./landmarkTransport";

const indices = new Set([
  "AdvectionSourceIndex",
  "UpwindTargets",
  "UpwindOceanSources",
  "IceFlowTargets",
  "DrainageParents",
  "DrainageRanks",
  "DrainageGuidanceTargets",
  "FlowTargets",
  "LakeOutletTargets",
  "FlowEdges",
  "RiverSpineEdgeMasks",
  "FlowAccumulation",
  "CatchmentArea",
  "IceFlux",
  "RiverOrders",
  "RiverWidth",
  "RiverDepth",
  "RiverChannelStrength",
  "RiverChannelOrders",
  "FloodplainIntensity",
  "DeltaIntensity",
]);
const categories = new Set([
  "BiomeCodes",
  "CrustAssemblyIds",
  "CrustPlateIds",
  "CrustSuturePairIds",
  "CrustProvinceIds",
  "CrustTypeCodes",
  "MarginCodes",
  "CoastalMarginCodes",
  "TectonicBoundaryCodes",
  "InitialTectonicBoundaryCodes",
  "TectonicBoundaryPairIds",
  "OrogenicComponentIds",
  "VolcanicLastActiveEpoch",
  "LandformCodes",
  "WaterKindCodes",
  "WaterBodyIds",
  "DrainageBasinIds",
  "RiverOrders",
  "RiverChannelOrders",
  "FeatureFlags",
  "LandmassIds",
  "LandmassClassCodes",
  "ContinentalGroupIds",
  "BathymetricZoneCodes",
  "GroundedIce",
  "WaterSurfaceElevations",
  // Refinement inherits historical extrema; it does not invent a new observation.
  "MaximumIceThickness",
  "MaximumIceFlux",
  "MaximumGroundedIceFlux",
  "GeothermalHistory",
  "WaveExposureHistory",
  "ExternalCoastalForcingHistory",
]);
function setTransferred(next: PhysicalField, name: string, transferred: NumericalVector) {
  const target = next[name as keyof PhysicalField];
  if (!isNumericalVector(target)) throw new Error(`Missing remesh channel ${name}.`);
  for (let cell = 0; cell < next.mesh.count; cell++)
    target[cell] = transferred[next.mesh.cellToLeaf[cell]];
}
function transferChannels(
  map: PhysicalField,
  next: PhysicalField,
  transfer: ReturnType<typeof prepareAdaptiveTransfer>
) {
  for (const [name, values] of Object.entries(map)) {
    if (!isNumericalVector(values)) {
      if (name !== "mesh") Object.assign(next, { [name]: values });
      continue;
    }
    if (indices.has(name)) continue;
    const transferred = transfer(
      (leaf) => values[map.mesh.leafToCell[leaf]],
      categories.has(name) ? "category" : "intensive"
    );
    setTransferred(next, name, transferred);
    if (map.numerical) map.numerical.release(transferred);
  }
}
/** Transfer represented material and history; index-valued diagnostics must be rebuilt. */
export function remeshPhysical(
  map: PhysicalField,
  topology: AdaptiveTopology,
  footprint: Geometry,
  prepared?: ReturnType<typeof prepareAdaptiveTransfer>
) {
  const old = map.mesh;
  if (!old.topology) throw new Error("Adaptive remeshing requires an adaptive physical field.");
  const mesh = adaptivePhysicalMesh(topology, footprint, map.numerical);
  if (old.periodic) joinAdaptiveSeam(mesh, map.numerical);
  mesh.bounds = old.bounds;
  const next = createField(mesh, map.numerical);
  const transfer = prepared ?? prepareAdaptiveTransfer(old.topology, topology, map.numerical);
  transferChannels(map, next, transfer);
  // Elevation is a dependent material interface, not a second independently transferred mass.
  for (let i = 0; i < mesh.count; i++)
    next.Elevation[i] = next.BedrockElevation[i] + next.SedimentThickness[i];
  reconcileRemeshedWater(map, next);
  remeshLandmarkDrainage(map, next, transfer);
  return next;
}
