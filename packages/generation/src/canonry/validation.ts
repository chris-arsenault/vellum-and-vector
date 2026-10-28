// PhysicalGeographyValidationLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { noWaterSurface } from "./math";
import { sourceToOutletOrder } from "./flowGraph";
import { isGrounded } from "./glacierSurface";
import { validateLandscape } from "./surface";
import { allowsBoundaryDrainage, isOpenOutlet } from "./field";
import { releaseWorking } from "./physicalNumerics";

const range = (value: number, low: number, high: number) => value >= low && value <= high;
function validateCodes(map: PhysicalField, unclassified = false) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (
      !range(map.LandformCodes.get(i), unclassified ? 0 : 1, 17) ||
      !range(map.WaterKindCodes.get(i), 0, 2) ||
      !range(map.BathymetricZoneCodes.get(i), 0, 4) ||
      (map.FeatureFlags.get(i) & ~4095) !== 0
    )
      throw new Error("Physical geography contains an invalid primitive code.");
    validateRiverCodes(map, i);
  }
}
function validateRiverCodes(map: PhysicalField, i: number) {
  if (
    !range(map.RiverChannelStrength.get(i), 0, 1000) ||
    map.RiverChannelOrders.get(i) < 0 ||
    !range(map.FloodplainIntensity.get(i), 0, 1000) ||
    !range(map.DeltaIntensity.get(i), 0, 1000)
  )
    throw new Error("Physical geography contains an invalid river-geometry value.");
}
function validateWaterState(map: PhysicalField, i: number) {
  const dry = map.WaterKindCodes.get(i) === 0,
    surface = map.WaterSurfaceElevations.get(i),
    depth = map.WaterDepths.get(i);
  if (dry !== (surface === noWaterSurface) || dry !== (depth === 0))
    throw new Error("Physical water surface and depth disagree.");
  if (!dry && surface - map.Elevation.get(i) !== depth)
    throw new Error("Physical water depth does not match surface minus floor.");
}
/** `surfaces` holds each body's surface by id, NaN until its first lake triangle. */
function validateLakeSurface(map: PhysicalField, i: number, surfaces: Float64Array) {
  const body = map.WaterBodyIds.get(i),
    surface = map.WaterSurfaceElevations.get(i);
  if (
    body <= 1 ||
    map.WaterDepths.get(i) <= 0 ||
    (!Number.isNaN(surfaces[body]) && surfaces[body] !== surface)
  )
    throw new Error("Lake triangle lacks a consistent water surface.");
  surfaces[body] = surface;
}
function validateWater(map: PhysicalField) {
  let ocean = 0,
    bodies = 0;
  for (let i = 0; i < map.mesh.count; i++) bodies = Math.max(bodies, map.WaterBodyIds.get(i) + 1);
  const surfaces = new Float64Array(bodies).fill(NaN);
  for (let i = 0; i < map.mesh.count; i++) {
    validateWaterState(map, i);
    const water = map.WaterKindCodes.get(i);
    if (water === 1) {
      ocean++;
      if (map.WaterBodyIds.get(i) !== 1 || map.WaterDepths.get(i) <= 0)
        throw new Error("Ocean triangle lacks depth or body identity.");
    } else if (water === 2) {
      validateLakeSurface(map, i, surfaces);
    }
  }
  if (ocean === 0 && !allowsBoundaryDrainage(map))
    throw new Error("Physical geography contains no connected ocean.");
}
function validateRivers(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.RiverOrders.get(i) <= 0) continue;
    const target = map.FlowTargets.get(i);
    if (
      (target < 0 && !isOpenOutlet(map, i)) ||
      (target >= 0 &&
        map.WaterKindCodes.get(target) !== 2 &&
        map.FlowAccumulation.get(target) + 1e-9 < map.FlowAccumulation.get(i))
    )
      throw new Error("River network does not continue toward an outlet.");
  }
}
function validateIce(map: PhysicalField, c: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++) {
    const grounded = map.GroundedIce.get(i);
    const invalidGrounding =
      !range(grounded, 0, 1) || (grounded !== 0 && !isGrounded(map, i, c.Profile));
    if (invalidGrounding || map.MaximumGroundedIceFlux.get(i) > map.MaximumIceFlux.get(i))
      throw new Error(
        `Grounded-ice history contradicts physical support at (${map.mesh.x(i)}, ${map.mesh.y(i)}): grounded=${grounded}, ice=${map.IceThickness.get(i)}, water=${map.WaterKindCodes.get(i)}, depth=${map.WaterDepths.get(i)}, maximumGroundedFlux=${map.MaximumGroundedIceFlux.get(i)}, maximumFlux=${map.MaximumIceFlux.get(i)}.`
      );
  }
}
export function validatePhysical(map: PhysicalField, c: PhysicalContext) {
  validateCodes(map, c.Products?.status("canonry:Landforms") === "empty");
  validateWater(map);
  releaseWorking(map, sourceToOutletOrder(map));
  validateRivers(map);
  validateIce(map, c);
  validateLandscape(map);
}
export function epochHistory(map: PhysicalField, c: PhysicalContext) {
  if (!c.IsEvolutionEpoch || c.EpochIndex !== map.CompletedEpochCount)
    throw new Error("Physical epoch history was applied out of order.");
  for (let i = 0; i < map.mesh.count; i++)
    map.GeothermalHistory.set(i, Math.max(map.GeothermalHistory.get(i), map.Geothermal.get(i)));
  map.CompletedEpochCount++;
}
