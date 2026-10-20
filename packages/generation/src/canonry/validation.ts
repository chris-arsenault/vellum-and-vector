// PhysicalGeographyValidationLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { noWaterSurface } from "./math";
import { sourceToOutletOrder } from "./flowGraph";
import { isGrounded } from "./glacierSurface";
import { validateLandscape } from "./surface";
import { allowsBoundaryDrainage, isOpenOutlet } from "./field";

const range = (value: number, low: number, high: number) => value >= low && value <= high;
function validateCodes(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (
      !range(map.LandformCodes[i], 1, 17) ||
      !range(map.WaterKindCodes[i], 0, 2) ||
      !range(map.BathymetricZoneCodes[i], 0, 4) ||
      (map.FeatureFlags[i] & ~2047) !== 0
    )
      throw new Error("Physical geography contains an invalid primitive code.");
    if (
      !range(map.RiverChannelStrength[i], 0, 1000) ||
      map.RiverChannelOrders[i] < 0 ||
      !range(map.FloodplainIntensity[i], 0, 1000) ||
      !range(map.DeltaIntensity[i], 0, 1000)
    )
      throw new Error("Physical geography contains an invalid river-geometry value.");
  }
}
function validateWaterState(map: PhysicalField, i: number) {
  const dry = map.WaterKindCodes[i] === 0,
    surface = map.WaterSurfaceElevations[i],
    depth = map.WaterDepths[i];
  if (dry !== (surface === noWaterSurface) || dry !== (depth === 0))
    throw new Error("Physical water surface and depth disagree.");
  if (!dry && surface - map.Elevation[i] !== depth)
    throw new Error("Physical water depth does not match surface minus floor.");
}
function validateLakeSurface(map: PhysicalField, i: number, surfaces: Map<number, number>) {
  const body = map.WaterBodyIds[i],
    surface = map.WaterSurfaceElevations[i];
  if (
    body <= 1 ||
    map.WaterDepths[i] <= 0 ||
    (surfaces.has(body) && surfaces.get(body) !== surface)
  )
    throw new Error(
      `Lake cell ${i} has body ${body}, surface ${surface}, depth ${map.WaterDepths[i]}; the body's previous surface was ${surfaces.get(body)}.`
    );
  surfaces.set(body, surface);
}
function validateWater(map: PhysicalField) {
  let ocean = 0;
  const surfaces = new Map<number, number>();
  for (let i = 0; i < map.mesh.count; i++) {
    validateWaterState(map, i);
    if (map.WaterKindCodes[i] === 1) {
      ocean++;
      if (map.WaterBodyIds[i] !== 1 || map.WaterDepths[i] <= 0)
        throw new Error("Ocean triangle lacks depth or body identity.");
    } else if (map.WaterKindCodes[i] === 2) {
      validateLakeSurface(map, i, surfaces);
    }
  }
  if (ocean === 0 && !allowsBoundaryDrainage(map))
    throw new Error("Physical geography contains no connected ocean.");
}
function validateRivers(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.RiverOrders[i] <= 0) continue;
    const target = map.FlowTargets[i];
    if (
      (target < 0 && !isOpenOutlet(map, i)) ||
      (target >= 0 &&
        map.WaterKindCodes[target] !== 2 &&
        map.FlowAccumulation[target] + 1e-9 < map.FlowAccumulation[i])
    )
      throw new Error("River network does not continue toward an outlet.");
  }
}
function validateIce(map: PhysicalField, c: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++) {
    const invalidGrounding =
      !range(map.GroundedIce[i], 0, 1) ||
      (map.GroundedIce[i] !== 0 && !isGrounded(map, i, c.Profile));
    if (invalidGrounding || map.MaximumGroundedIceFlux[i] > map.MaximumIceFlux[i])
      throw new Error(
        `Grounded-ice history contradicts physical support at (${map.mesh.x[i]}, ${map.mesh.y[i]}): grounded=${map.GroundedIce[i]}, ice=${map.IceThickness[i]}, water=${map.WaterKindCodes[i]}, depth=${map.WaterDepths[i]}, maximumGroundedFlux=${map.MaximumGroundedIceFlux[i]}, maximumFlux=${map.MaximumIceFlux[i]}.`
      );
  }
}
export function validatePhysical(map: PhysicalField, c: PhysicalContext) {
  validateCodes(map);
  validateWater(map);
  sourceToOutletOrder(map);
  validateRivers(map);
  validateIce(map, c);
  validateLandscape(map);
}
export function epochHistory(map: PhysicalField, c: PhysicalContext) {
  if (!c.IsEvolutionEpoch || c.EpochIndex !== map.CompletedEpochCount)
    throw new Error("Physical epoch history was applied out of order.");
  for (let i = 0; i < map.mesh.count; i++)
    map.GeothermalHistory[i] = Math.max(map.GeothermalHistory[i], map.Geothermal[i]);
  map.CompletedEpochCount++;
}
