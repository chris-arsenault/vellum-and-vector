// TemperatureLayer, MoistureLayer, PrecipitationLayer and RunoffLayer, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, round, toUnits, truncate } from "./math";
import { unitNoise } from "./noise";
import { physicalDistance } from "./physicalMetric";

export function temperature(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    const lapse = truncate(
      (toUnits(Math.max(0, map.Elevation[i] - map.EffectiveSeaLevel)) *
        p.ElevationTemperatureLapse) /
        p.ElevationScale
    );
    const moderation =
      map.OceanDistance[i] < 0
        ? 0
        : Math.max(
            0,
            p.OceanModerationStrength -
              truncate(
                (map.OceanDistance[i] * p.OceanModerationStrength) / p.OceanModerationDistance
              )
          );
    const heat = truncate((map.Geothermal[i] * p.GeothermalTemperatureStrength) / 1000);
    const current = truncate(
      (truncate((map.OceanCurrentHeat[i] * map.OceanCurrentStrength[i]) / 1000) *
        p.OceanCurrentTemperatureStrength) /
        1000
    );
    map.Temperature[i] = clamp(
      p.TemperatureBaseline +
        c.TemperatureOffset -
        lapse +
        moderation +
        heat +
        current +
        map.Warmth[i] +
        map.ExternalHeatForcing[i],
      0,
      1000
    );
  }
}
export function moisture(map: PhysicalField, c: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 0) {
      map.Moisture[i] = 1000;
      continue;
    }
    const exposure =
      map.OceanDistance[i] < 0
        ? 0
        : Math.max(
            0,
            720 - truncate((map.OceanDistance[i] * 720) / c.Profile.OceanMoistureDistance)
          );
    const weather = round(unitNoise(map.mesh.x[i], map.mesh.y[i], c.Seed, 310_000, 3) * 230);
    const shadow = truncate((map.MoistureBarriers[i] * c.Profile.RainShadowStrength) / 1000);
    const thaw = truncate(Math.max(0, map.Temperature[i] - 260) / 3);
    map.Moisture[i] = clamp(80 + exposure + weather + thaw - shadow, 0, 1000);
  }
}
function oceanEvaporation(map: PhysicalField, i: number): number {
  const source = map.UpwindOceanSources[i];
  return source < 0
    ? 0
    : clamp(
        truncate((map.OceanCurrentHeat[source] * 3) / 5) +
          truncate((map.WaveExposure[source] * 2) / 5),
        0,
        1000
      );
}
export function precipitation(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    const upwind = map.UpwindTargets[i];
    const lift =
      upwind < 0
        ? 0
        : clamp(
            truncate(
              ((map.Elevation[i] - map.Elevation[upwind]) /
                1024 /
                physicalDistance(map.mesh, i, upwind)) *
                30_000
            ),
            0,
            1000
          );
    const total = clamp(
      p.PrecipitationBaseline +
        truncate((map.Moisture[i] * 680) / 1000) +
        truncate((oceanEvaporation(map, i) * p.CurrentEvaporationStrength) / 1000) +
        truncate((lift * p.OrographicPrecipitationStrength) / 1000) -
        truncate((map.PrecipitationBarriers[i] * p.RainShadowStrength) / 1000),
      0,
      1000
    );
    const snow = clamp(
      truncate(
        ((p.SnowTemperatureThreshold +
          truncate(p.SnowTemperatureTransition / 2) -
          map.Temperature[i]) *
          1000) /
          p.SnowTemperatureTransition
      ),
      0,
      1000
    );
    map.Snowfall[i] = truncate((total * snow) / 1000);
    map.Rainfall[i] = total - map.Snowfall[i];
  }
}
export function runoff(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] === 1) {
      map.Runoff[i] = 0;
      continue;
    }
    const melt = clamp(
      truncate(
        ((map.Temperature[i] - (p.SnowTemperatureThreshold - p.SnowTemperatureTransition)) * 1000) /
          p.SnowTemperatureTransition
      ),
      0,
      1000
    );
    const available = clamp(map.Rainfall[i] + truncate((map.Snowfall[i] * melt) / 1000), 0, 1000);
    const loss = clamp(
      p.RunoffMinimumLossPerMille +
        truncate((map.Temperature[i] * p.RunoffTemperatureLossPerMille) / 1000),
      0,
      1000
    );
    map.Runoff[i] = truncate((available * (1000 - loss)) / 1000);
  }
}
