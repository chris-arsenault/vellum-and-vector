import { prepareAdaptiveTransfer, type AdaptiveTopology } from "@atlas/domain";
import type { Geometry } from "geojson";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { createField, type PhysicalField } from "./field";
import { reconcileRemeshedWater } from "./remeshWater";

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
  "CrustAssemblyIds",
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
function setTransferred(next: PhysicalField, name: string, transferred: Float64Array) {
  const target = next[name as keyof PhysicalField];
  if (!(
    target instanceof Int32Array ||
    target instanceof Float64Array ||
    target instanceof Float32Array
  ))
    throw new Error(`Missing remesh channel ${name}.`);
  next.mesh.cellToLeaf.forEach((leaf, cell) => {
    target[cell] = transferred[leaf];
  });
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
  mesh.bounds = old.bounds;
  const next = createField(mesh);
  const transfer = prepared ?? prepareAdaptiveTransfer(old.topology, topology);
  for (const [name, values] of Object.entries(map)) {
    if (!ArrayBuffer.isView(values)) {
      if (name !== "mesh") Object.assign(next, { [name]: values });
      continue;
    }
    if (indices.has(name)) continue;
    const source = Float64Array.from(old.leafToCell, (cell) => values[cell]);
    const transferred = transfer(source, categories.has(name) ? "category" : "intensive");
    setTransferred(next, name, transferred);
  }
  // Elevation is a dependent material interface, not a second independently transferred mass.
  for (let i = 0; i < mesh.count; i++)
    next.Elevation[i] = next.BedrockElevation[i] + next.SedimentThickness[i];
  reconcileRemeshedWater(map, next);
  return next;
}
