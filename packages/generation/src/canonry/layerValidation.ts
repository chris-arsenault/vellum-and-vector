// Numerical invariants from Canonry's layer Validate methods. Spatial authoring
// validation remains at the GIS projection boundary.
import type { PhysicalField, PhysicalIntegerName as IntegerName } from "./field";
import type { PhysicalContext } from "./context";
import { validateLandscape } from "./surface";
import { isOpenOutlet } from "./field";
import { sourceToOutletOrder } from "./flowGraph";
import { edgeLeadingTo } from "./mesh";
import { isGrounded } from "./glacierSurface";
import { releaseWorking } from "./physicalNumerics";

function scalar(map: PhysicalField, name: IntegerName, low = 0, high = 1000) {
  const outside = map.coverage.reduce(
    map[name],
    (held, value) => held + (value < low || value > high ? 1 : 0),
    0
  );
  if (outside) throw new Error(`Canonry ${name} left its physical range.`);
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
/** Water rates in mm/year, bounded by the precipitation ceiling rather than per-mille. */
const waterRates = new Set<IntegerName>(["Rainfall", "Snowfall", "Runoff"]);
function validateScalars(map: PhysicalField, c: PhysicalContext, produces: string[]) {
  for (const fact of produces)
    for (const channel of scalars[fact] ?? [])
      scalar(map, channel, 0, waterRates.has(channel) ? c.Profile.PrecipitationCeiling : 1000);
}
function validateDrainage(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++) {
    const target = map.FlowTargets.get(i),
      water = map.WaterKindCodes.get(i);
    if (target < 0) {
      if (water === 0 && !isOpenOutlet(map, i))
        throw new Error("Dry triangle has no drainage outlet.");
      continue;
    }
    if (edgeLeadingTo(map.mesh, i, target) < 0)
      throw new Error("Flow target is not an adjacent triangle.");
    if (
      water === 0 &&
      map.WaterKindCodes.get(target) !== 1 &&
      map.DrainageElevations.get(target) > map.DrainageElevations.get(i)
    )
      throw new Error("Conditioned drainage flows uphill.");
  }
  releaseWorking(map, sourceToOutletOrder(map));
}
function validateChannels(map: PhysicalField) {
  scalar(map, "RiverChannelStrength");
  for (let i = 0; i < map.mesh.count; i++) {
    const strength = map.RiverChannelStrength.get(i),
      order = map.RiverChannelOrders.get(i),
      river = map.RiverOrders.get(i);
    if (
      order < 0 ||
      (strength === 0) !== (order === 0) ||
      (strength > 0 && map.WaterKindCodes.get(i) !== 0)
    )
      throw new Error("River channel coverage is inconsistent with its flow spine.");
    if (river > 0 && (strength <= 0 || order < river))
      throw new Error("River channel does not cover its flow spine.");
  }
}
function validateIce(map: PhysicalField, c: PhysicalContext) {
  scalar(map, "GroundedIce", 0, 1);
  for (let i = 0; i < map.mesh.count; i++) {
    if (
      map.IceFlux.get(i) + 1e-6 <
        (map.IceThickness.get(i) * map.mesh.area(i)) / c.Profile.IceTransportYears ||
      (map.GroundedIce.get(i) !== 0 && !isGrounded(map, i, c.Profile))
    )
      throw new Error("Ice flow or grounding contradicts its support surface.");
  }
}
function validateBudget(map: PhysicalField) {
  const supplied = map.coverage.reduce(
    map.SedimentSupply,
    (held, value) => held + (value !== 0 ? 1 : 0),
    0
  );
  if (
    Math.abs(map.SedimentDepositedTotal + map.SedimentExportedTotal - map.SedimentProducedTotal) >
      Math.max(0.001, map.SedimentProducedTotal * 1e-9) ||
    supplied
  )
    throw new Error("Sediment transport did not conserve its supplied load.");
}
export function validateNativeLayer(
  map: PhysicalField,
  c: PhysicalContext,
  name: string,
  produces: string[]
) {
  validateScalars(map, c, produces);
  if (map.CrustSupportInitialized) validateLandscape(map);
  if (name === "flow-routing") validateDrainage(map);
  if (name === "river-channel-geometry") validateChannels(map);
  if (name === "ice-flow") validateIce(map, c);
  if (name === "sediment-transport" || name === "glacial-deposition") validateBudget(map);
}
