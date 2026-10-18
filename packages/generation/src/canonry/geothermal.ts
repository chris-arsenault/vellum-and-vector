// GeothermalLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, round, truncate } from "./math";
import { fractalNoise, unitNoise } from "./noise";
import { Feature } from "./codes";

export function geothermal(map: PhysicalField, c: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++) {
    map.FeatureFlags[i] &= ~Feature.GeothermalVent;
    const strain = map.TectonicStrain[i] / 1000;
    const boundary = [0, 0.43, 0.58, 0.24][map.TectonicBoundaryCodes[i]] * strain;
    const fracture = (map.FractureConductance[i] / 1000) * 0.28;
    const impact = ((map.ImpactHeat[i] / 1000) * 0.36) / Math.max(1, map.CompletedEpochCount + 1);
    const lobes = fractalNoise(
      map.mesh.x[i],
      map.mesh.y[i],
      c.Seed ^ 0x4d13,
      c.Profile.PlumeLobeScale,
      3
    );
    const plume =
      (map.VolcanicActivity[i] / 1000) *
      0.68 *
      clamp(1 + (lobes * c.Profile.PlumeLobeStrength) / 1000, 0, 1.6);
    const broad =
      unitNoise(
        map.mesh.x[i],
        map.mesh.y[i],
        c.Seed,
        Math.max(14, map.mesh.contentRadius * 0.34),
        2
      ) * 0.1;
    map.Geothermal[i] = round(clamp(boundary + fracture + impact + plume + broad, 0, 1) * 1000);
    map.HeatSourceDensity[i] = clamp(
      truncate(
        (map.Geothermal[i] * 2 +
          map.FractureConductance[i] +
          map.TectonicStrain[i] +
          map.VolcanicActivity[i]) /
          4
      ),
      0,
      1000
    );
    const provenance =
      map.TectonicStrain[i] >= 180 ||
      map.FractureConductance[i] >= 560 ||
      map.VolcanicActivity[i] > 0 ||
      (map.FeatureFlags[i] & Feature.MantlePlume) !== 0;
    if (map.Geothermal[i] >= c.Profile.GeothermalVentThreshold && provenance)
      map.FeatureFlags[i] |= Feature.GeothermalVent;
  }
}
