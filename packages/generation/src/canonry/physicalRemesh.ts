import { prepareAdaptiveTransfer, Band, type AdaptiveTopology } from "@atlas/domain";
import type { Geometry } from "geojson";
import { adaptivePhysicalMesh, AdaptiveLattice } from "./adaptiveMesh";
import { createField, physicalBands, type PhysicalField } from "./field";
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
function transferChannels(
  map: PhysicalField,
  next: PhysicalField,
  transfer: ReturnType<typeof prepareAdaptiveTransfer>
) {
  for (const [name, value] of Object.entries(map)) {
    if (value instanceof Band) continue;
    if (name !== "mesh" && name !== "coverage") Object.assign(next, { [name]: value });
  }
  for (const [name, values] of physicalBands(map)) {
    if (indices.has(name)) continue;
    const transferred = transfer(
      (leaf) => values.get(map.mesh.leafToCell(leaf)),
      categories.has(name) ? "category" : "intensive"
    );
    const target = next[name];
    for (let cell = 0; cell < next.mesh.count; cell++)
      target.set(cell, transferred.get(next.mesh.cellToLeaf(cell)));
    transferred.release();
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
  const mesh = adaptivePhysicalMesh(topology, footprint);
  if (old.periodic && mesh instanceof AdaptiveLattice) mesh.joinSeam();
  mesh.bounds = old.bounds;
  const next = createField(mesh, map.coverage.cache);
  const transfer = prepared ?? prepareAdaptiveTransfer(old.topology, topology);
  transferChannels(map, next, transfer);
  // Elevation is a dependent material interface, not a second independently transferred mass.
  for (let i = 0; i < mesh.count; i++)
    next.Elevation.set(i, next.BedrockElevation.get(i) + next.SedimentThickness.get(i));
  reconcileRemeshedWater(map, next);
  remeshLandmarkDrainage(map, next, transfer);
  return next;
}
