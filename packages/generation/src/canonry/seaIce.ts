// SeaIceLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, round, truncate } from "./math";
import { fractalNoise } from "./noise";
import { Feature } from "./codes";

export function seaIce(map: PhysicalField, c: PhysicalContext) {
  const ocean: number[] = [],
    p = c.Profile;
  map.SeaIceSuitability.fill(0);
  for (let i = 0; i < map.mesh.count; i++) {
    map.FeatureFlags[i] &= ~(Feature.PermanentSeaIce | Feature.PermanentIceMargin);
    if (map.WaterKindCodes[i] !== 1 || i >= map.mesh.contentCount) continue;
    map.IceThickness[i] = 0;
    ocean.push(i);
    const coherence = round(
      fractalNoise(map.mesh.x[i], map.mesh.y[i], c.Seed, p.SeaIceVariationScale, 3) *
        p.SeaIceSuitabilityVariation
    );
    const value = clamp(
      1000 -
        map.Temperature[i] -
        truncate((map.OceanCurrentStrength[i] * p.SeaIceCurrentResistance) / 1000) -
        truncate((map.WaveExposure[i] * p.SeaIceWaveResistance) / 1000) -
        truncate(map.OceanCurrentHeat[i] / 5) +
        coherence,
      0,
      1000
    );
    map.SeaIceSuitability[i] = value;
  }
  // Ice extent follows the cold itself rather than a requested coverage share.
  const cutoff = 1000 - p.SeaIceFormationTemperature;
  for (const i of ocean) {
    const cold = map.SeaIceSuitability[i];
    if (cold < cutoff || map.Temperature[i] > p.IceMarginTemperature) continue;
    map.IceThickness[i] = clamp(50 + (cold - cutoff) * 2, 50, 240);
    map.FeatureFlags[i] |=
      map.Temperature[i] <= p.PermanentSeaIceTemperature
        ? Feature.PermanentSeaIce
        : Feature.PermanentIceMargin;
  }
}
