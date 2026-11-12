// Numerical invariants of the world's steps. Spatial authoring validation remains at the GIS
// projection boundary.
import type { PhysicalField, PhysicalBufferName } from "./field";
import type { PhysicalContext } from "./context";
import { validateLandscape } from "../rock/groundInitialization";
import { isOpenOutlet } from "./field";
import { sourceToOutletOrder } from "./flowGraph";
import { edgeLeadingTo } from "./mesh";
import { isGrounded } from "./glacierSurface";
import { releaseWorking } from "./physicalNumerics";
import { riverOrderAt } from "../water/riverKeeping";

function scalar(map: PhysicalField, name: PhysicalBufferName, low = 0, high = 1000) {
  const outside = map.coverage.reduce(
    map[name],
    (held, value) => held + (value < low || value > high ? 1 : 0),
    0
  );
  if (outside) throw new Error(`${name} left its physical range.`);
}
/** Bands that hold a share or a rate, whose range is checked whenever a step writes them. */
const scalars = new Set<string>([
  "Moisture",
  "Rainfall",
  "Snowfall",
  "Runoff",
  "GlacialMeltwater",
  "Geothermal",
  "HeatSourceDensity",
  "FractureConductance",
  "CrustSutureStrength",
  "CrustCollisionIntensity",
  "CrustAge",
  "OceanCurrentStrength",
  "OceanCurrentHeat",
  "WaveExposure",
  "MoistureBarriers",
  "PrecipitationBarriers",
  "SeaIceSuitability",
  "FloodplainIntensity",
  "DeltaIntensity",
]);
/** Water depth rates in mm/year are nonnegative, not per-mille shares. */
const waterRates = new Set<string>(["Rainfall", "Snowfall", "Runoff", "GlacialMeltwater"]);
function validateScalars(map: PhysicalField, c: PhysicalContext, writes: readonly string[]) {
  for (const band of writes)
    if (scalars.has(band))
      scalar(map, band as PhysicalBufferName, 0, waterRates.has(band) ? Infinity : 1000);
}
export function validateDrainage(map: PhysicalField) {
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
export function validateChannels(map: PhysicalField) {
  scalar(map, "RiverChannelStrength");
  for (let i = 0; i < map.mesh.count; i++) {
    const strength = map.RiverChannelStrength.get(i),
      order = map.RiverChannelOrders.get(i),
      river = riverOrderAt(map, i);
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
export function validateIce(map: PhysicalField, c: PhysicalContext) {
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
/** What holds after any step: the bands it wrote are in range and the land is one surface. */
export function validateNativeLayer(
  map: PhysicalField,
  c: PhysicalContext,
  writes: readonly string[]
) {
  validateScalars(map, c, writes);
  if (map.CrustSupportInitialized) validateLandscape(map);
}
