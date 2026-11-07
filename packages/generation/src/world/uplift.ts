// TectonicUpliftLayer.cs, Canonry 0f62584c: crustal thickness owns height.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { buoyancy, clamp, crustHeight, scaled, thickness, units } from "./math";
import { meshNoise as fractalNoise, hashUnit } from "./noise";

function interiorRelief(map: PhysicalField, context: PhysicalContext, i: number): number {
  const p = context.Profile;
  const continentality = clamp((map.ContinentalPotential.get(i) / 1000 - 0.45) / 0.25, 0, 1);
  if (continentality <= 0) return 0;
  let macro =
    fractalNoise(
      map.mesh,
      map.mesh.x(i),
      map.mesh.y(i),
      context.EpochStableSeed ^ 0x5ee1,
      p.InteriorReliefScale,
      4
    ) * p.InteriorReliefStrength;
  if (macro < 0) macro *= p.InteriorBasinDepthShare / 1000;
  return continentality * macro;
}
function initializeSurface(
  map: PhysicalField,
  context: PhysicalContext,
  i: number,
  fraction: number
) {
  const p = context.Profile,
    province = map.CrustProvinceIds.get(i);
  const variation =
    fractalNoise(
      map.mesh,
      map.mesh.x(i),
      map.mesh.y(i),
      context.Seed ^ 0x52c9,
      p.ElevationVariationScale,
      3
    ) * p.ElevationVariationStrength;
  const provinceOffset =
    province < 0 ? 0 : (hashUnit(context.Seed ^ 0x3d7b, province, 0x51a9) - 0.5) * 2 * 520;
  const relief =
    interiorRelief(map, context, i) - map.CrustAssemblySeparation.get(i) / 1000 + variation;
  const column = thickness(
    1000 +
      3000 * fraction +
      provinceOffset * fraction +
      (relief * p.ElevationScale) / (buoyancy(fraction) / 1000)
  );
  map.CrustThickness.set(i, units(column));
  map.Elevation.set(i, scaled(crustHeight(column, fraction) / p.ElevationScale, p.ElevationScale));
}
export function tectonicUplift(map: PhysicalField, context: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (!context.IsEvolutionEpoch)
      initializeSurface(map, context, i, map.CrustContinentalFraction.get(i) / 1000);
    const inherited = clamp(
      map.TectonicActivityHistory.get(i) /
        Math.max(1, context.Profile.EpochTectonicElevationStep * 1.8),
      0,
      1
    );
    const suture = map.CrustSutureStrength.get(i) / 1000;
    map.Uplift.set(
      i,
      clamp(
        (map.ContinentalPotential.get(i) / 1000) * 0.32 + inherited * 0.3 + suture * 0.74,
        0,
        1.5
      )
    );
    map.RidgeInfluence.set(i, clamp(Math.max(suture * 0.92, inherited * 0.52), 0, 1));
  }
}
