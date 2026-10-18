// Numerical invariants from Canonry's layer Validate methods. Spatial authoring
// validation remains at the GIS projection boundary.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { validateLandscape } from "./surface";
import { sourceToOutletOrder } from "./flowGraph";
import { edgeLeadingTo } from "./mesh";
import { isGrounded } from "./glacierSurface";

type IntegerName = {
  [K in keyof PhysicalField]: PhysicalField[K] extends Int32Array ? K : never;
}[keyof PhysicalField];
function scalar(map: PhysicalField, name: IntegerName, low = 0, high = 1000) {
  for (const value of map[name])
    if (value < low || value > high) throw new Error(`Canonry ${name} left its physical range.`);
}
const scalars: Record<string, IntegerName[]> = {
  Temperature: ["Temperature"],
  Moisture: ["Moisture"],
  Precipitation: ["Rainfall", "Snowfall"],
  Runoff: ["Runoff"],
  Geothermal: ["Geothermal", "HeatSourceDensity"],
  Fractures: ["FractureConductance"],
  ContinentalSutures: ["CrustSutureStrength", "CrustCollisionIntensity"],
  TectonicMargins: ["CrustAge"],
  OceanCurrents: ["OceanCurrentStrength", "OceanCurrentHeat", "WaveExposure"],
  AtmosphericFlow: ["MoistureBarriers", "PrecipitationBarriers"],
  GlacialMeltwater: ["GlacialMeltwater"],
  SeaIce: ["SeaIceSuitability"],
  Floodplains: ["FloodplainIntensity"],
  Deltas: ["DeltaIntensity"],
};
function validateDrainage(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++) {
    const target = map.FlowTargets[i];
    if (target < 0) {
      if (map.WaterKindCodes[i] === 0 && !(map.OpenBoundary && map.mesh.boundary[i]))
        throw new Error("Dry triangle has no drainage outlet.");
      continue;
    }
    if (edgeLeadingTo(map.mesh, i, target) < 0)
      throw new Error("Flow target is not an adjacent triangle.");
    if (
      map.WaterKindCodes[i] === 0 &&
      map.WaterKindCodes[target] !== 1 &&
      map.DrainageElevations[target] > map.DrainageElevations[i]
    )
      throw new Error("Conditioned drainage flows uphill.");
  }
  sourceToOutletOrder(map);
}
function validateChannels(map: PhysicalField) {
  scalar(map, "RiverChannelStrength");
  for (let i = 0; i < map.mesh.count; i++) {
    const strength = map.RiverChannelStrength[i],
      order = map.RiverChannelOrders[i];
    if (
      order < 0 ||
      (strength === 0) !== (order === 0) ||
      (strength > 0 && map.WaterKindCodes[i] !== 0)
    )
      throw new Error("River channel coverage is inconsistent with its flow spine.");
    if (map.RiverOrders[i] > 0 && (strength <= 0 || order < map.RiverOrders[i]))
      throw new Error("River channel does not cover its flow spine.");
  }
}
function validateIce(map: PhysicalField, c: PhysicalContext) {
  scalar(map, "GroundedIce", 0, 1);
  for (let i = 0; i < map.mesh.count; i++) {
    if (
      map.IceFlux[i] < map.IceThickness[i] ||
      (map.GroundedIce[i] !== 0 && !isGrounded(map, i, c.Profile))
    )
      throw new Error("Ice flow or grounding contradicts its support surface.");
  }
}
function validateBudget(map: PhysicalField) {
  if (
    map.SedimentDepositedTotal + map.SedimentExportedTotal !== map.SedimentProducedTotal ||
    map.SedimentSupply.some((value) => value !== 0)
  )
    throw new Error("Sediment transport did not conserve its supplied load.");
}
export function validateNativeLayer(
  map: PhysicalField,
  c: PhysicalContext,
  name: string,
  produces: string[]
) {
  for (const fact of produces) for (const channel of scalars[fact] ?? []) scalar(map, channel);
  if (map.CrustSupportInitialized) validateLandscape(map);
  if (name === "flow-routing") validateDrainage(map);
  if (name === "river-channel-geometry") validateChannels(map);
  if (name === "ice-flow") validateIce(map, c);
  if (name === "sediment-transport" || name === "glacial-deposition") validateBudget(map);
}
