import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { toUnits } from "./math";
import { physicalDistance } from "./physicalMetric";

/** Saturation moisture of a column at a native temperature (ten units per °C, 0 °C at 300). */
export function saturation(p: PhysicalProfile, temperature: number) {
  return p.ColumnSaturation * Math.exp(p.ColumnSaturationGrowth * ((temperature - 300) / 10 - 20));
}
/**
 * Cells ordered so that each follows its single source (upwind air or
 * upstream water). A closed loop is broken at the cell that entered it last,
 * which then starts from boundary values.
 */
export function sourceOrder(sources: Int32Array) {
  const n = sources.length,
    state = new Uint8Array(n),
    boundary = new Uint8Array(n),
    order: number[] = [];
  for (let start = 0; start < n; start++) {
    if (state[start]) continue;
    const path: number[] = [];
    let current = start;
    while (current >= 0 && state[current] === 0) {
      state[current] = 1;
      path.push(current);
      current = sources[current];
    }
    if (current >= 0 && state[current] === 1) boundary[path[path.length - 1]] = 1;
    for (let k = path.length - 1; k >= 0; k--) {
      state[path[k]] = 2;
      order.push(path[k]);
    }
  }
  return { order, boundary };
}
export interface AirColumn {
  moisture: Float64Array;
  precipitation: Float64Array;
  airHeat: Float64Array;
  maritime: Float64Array;
}
const ocean = (map: PhysicalField, i: number) => map.WaterKindCodes[i] === 1;
function height(map: PhysicalField, i: number) {
  return ocean(map, i) ? 0 : Math.max(0, toUnits(map.Elevation[i] - map.EffectiveSeaLevel));
}
/**
 * March each air column downwind. Over the sea it gathers moisture toward
 * saturation and takes the sea-surface anomaly; over land it rains out with
 * distance and uplift, regains recycled evapotranspiration, and loses its
 * marine heat and maritime character. Magical heat enters the passing air.
 */
export function marchAirColumns(
  map: PhysicalField,
  c: PhysicalContext,
  rainout: (i: number) => number
): AirColumn {
  const p = c.Profile,
    n = map.mesh.count;
  const moisture = new Float64Array(n),
    precipitation = new Float64Array(n),
    airHeat = new Float64Array(n),
    marine = new Float64Array(n),
    maritime = new Float64Array(n),
    magic = new Float64Array(n);
  const { order, boundary } = sourceOrder(map.UpwindTargets);
  for (const i of order) {
    const u = boundary[i] ? -1 : map.UpwindTargets[i];
    const target = saturation(p, map.Temperature[i]) * p.OceanColumnHumidity;
    const d = u < 0 ? 0 : physicalDistance(map.mesh, u, i);
    const arriving: Air =
      u < 0
        ? {
            q: target * (ocean(map, i) ? 1 : p.BoundaryColumnHumidity),
            heat: 0,
            sea: Number(ocean(map, i)),
            orographic: 0,
          }
        : { q: moisture[u], heat: marine[u], sea: maritime[u], orographic: 0 };
    const air = ocean(map, i)
      ? overSea(map, p, i, arriving, d, target)
      : overLand(map, p, i, u, arriving, d, rainout(i));
    // Magic heat already in the air arrives decayed; this cell's forcing joins it downwind.
    const carried = u < 0 ? 0 : magic[u] * Math.exp(-d / p.MagicHeatAirLength);
    moisture[i] = Math.max(0, air.q);
    precipitation[i] = p.ColumnRainEfficiency * (rainout(i) * moisture[i] + air.orographic);
    marine[i] = air.heat;
    airHeat[i] = air.heat + carried;
    maritime[i] = air.sea;
    magic[i] = carried + map.ExternalHeatForcing[i] * p.MagicHeatAirShare;
  }
  return { moisture, precipitation, airHeat, maritime };
}
interface Air {
  q: number;
  heat: number;
  sea: number;
  orographic: number;
}
function overSea(
  map: PhysicalField,
  p: PhysicalProfile,
  i: number,
  air: Air,
  d: number,
  target: number
): Air {
  const exchange = 1 - Math.exp(-d / p.SeaExchangeLength);
  return {
    q: air.q + (target - air.q) * (1 - Math.exp(-d / p.SeaEvaporationLength)),
    heat: air.heat + (map.SeaSurfaceAnomaly[i] - air.heat) * exchange,
    sea: air.sea + (1 - air.sea) * exchange,
    orographic: 0,
  };
}
/** Uplift wrings out a share of the column; distance rains out the rest while evapotranspiration returns moisture. */
function overLand(
  map: PhysicalField,
  p: PhysicalProfile,
  i: number,
  u: number,
  air: Air,
  d: number,
  rainout: number
): Air {
  const rise = u < 0 ? 0 : Math.max(0, height(map, i) - height(map, u));
  const lifted = air.q * (1 - Math.exp(-rise / p.OrographicLiftHeight));
  const depletion = 1 - Math.exp((-d * rainout) / p.ColumnRainLength);
  return {
    q: (air.q - lifted) * (1 - depletion) + map.Evapotranspiration[i] * 1000 * depletion,
    heat: air.heat * Math.exp(-d / p.AirHeatLength),
    sea: air.sea * Math.exp(-d / p.MaritimeLength),
    orographic: lifted * (p.ColumnRainLength / Math.max(d, Math.sqrt(map.mesh.areas[i]))),
  };
}
