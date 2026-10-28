// SeaIceLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, round, truncate } from "./math";
import { meshNoise as fractalNoise } from "./noise";
import { Feature } from "./codes";

export function seaIce(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile;
  map.SeaIceSuitability.fill(0);
  for (let i = 0; i < map.mesh.count; i++) {
    map.FeatureFlags.set(
      i,
      map.FeatureFlags.get(i) & ~(Feature.PermanentSeaIce | Feature.PermanentIceMargin)
    );
    if (map.WaterKindCodes.get(i) !== 1 || map.mesh.membership(i) !== 1) continue;
    map.IceThickness.set(i, 0);
    const coherence = round(
      fractalNoise(map.mesh, map.mesh.x(i), map.mesh.y(i), c.Seed, p.SeaIceVariationScale, 3) *
        p.SeaIceSuitabilityVariation
    );
    const value = clamp(
      1000 -
        map.Temperature.get(i) -
        truncate((map.OceanCurrentStrength.get(i) * p.SeaIceCurrentResistance) / 1000) -
        truncate((map.WaveExposure.get(i) * p.SeaIceWaveResistance) / 1000) -
        truncate(map.OceanCurrentHeat.get(i) / 5) +
        coherence,
      0,
      1000
    );
    map.SeaIceSuitability.set(i, value);
  }
  // Ice extent follows the cold itself rather than a requested coverage share.
  const cutoff = 1000 - p.SeaIceFormationTemperature;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.membership(i) !== 1 || map.WaterKindCodes.get(i) !== 1) continue;
    const cold = map.SeaIceSuitability.get(i),
      temperature = map.Temperature.get(i);
    if (cold < cutoff || temperature > p.IceMarginTemperature) continue;
    map.IceThickness.set(i, clamp(50 + (cold - cutoff) * 2, 50, 240));
    map.FeatureFlags.set(
      i,
      map.FeatureFlags.get(i) |
        (temperature <= p.PermanentSeaIceTemperature
          ? Feature.PermanentSeaIce
          : Feature.PermanentIceMargin)
    );
  }
}
