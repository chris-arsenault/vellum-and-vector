import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { toUnits } from "./math";
import { smoothMetric } from "./metricSmoothing";
import { directionalSources } from "./directionalSources";

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
    magic = new Float64Array(n),
    carried = new Float64Array(n);
  const source = directionalSources(map, p, map.WindX, map.WindY);
  const { order } = sourceOrder(source.primary);
  for (let i = 0; i < n; i++) {
    moisture[i] =
      saturation(p, map.Temperature[i]) *
      p.OceanColumnHumidity *
      (ocean(map, i) ? 1 : p.BoundaryColumnHumidity);
    maritime[i] = Number(ocean(map, i));
  }
  // Stationary annual-mean columns: iteration changes no elapsed world time.
  let change: number;
  do {
    change = 0;
    for (const i of order) {
      const before = [moisture[i], marine[i], maritime[i], magic[i]];
      advance(i);
      change = Math.max(
        change,
        Math.abs(moisture[i] - before[0]),
        Math.abs(marine[i] - before[1]),
        Math.abs(maritime[i] - before[2]),
        Math.abs(magic[i] - before[3])
      );
    }
  } while (change > 0.05);
  spreadAcrossWind(map, p, carried, airHeat);
  return { moisture, precipitation, airHeat, maritime };

  function advance(i: number) {
    const target = saturation(p, map.Temperature[i]) * p.OceanColumnHumidity;
    const links = source.links[i],
      d = source.distance[i];
    const upstream = (values: ArrayLike<number>) =>
      links.reduce((sum, link) => sum + link.weight * values[link.i], 0);
    const arriving: Air = !links.length
      ? boundaryAir(map, p, i, target)
      : { q: upstream(moisture), heat: upstream(marine), sea: upstream(maritime), orographic: 0 };
    const upwindHeight = links.reduce((sum, link) => sum + link.weight * height(map, link.i), 0);
    const air = ocean(map, i)
      ? overSea(map, p, i, arriving, d, target)
      : overLand(map, p, i, links.length ? upwindHeight : height(map, i), arriving, d, rainout(i));
    // Air relaxes toward a share of the forcing beneath it over MagicHeatAirLength,
    // so carried heat depends on distance travelled, not on how many cells it crosses.
    const keep = Math.exp(
      -(links.length ? d : Math.sqrt(map.mesh.areas[i])) / p.MagicHeatAirLength
    );
    carried[i] = links.length ? upstream(magic) * keep : 0;
    moisture[i] = Math.max(0, air.q);
    // Subsiding air under the subtropical and polar highs also caps uplift rain.
    const belt = rainout(i);
    precipitation[i] =
      p.ColumnRainEfficiency * (belt * moisture[i] + Math.min(1, belt) * air.orographic);
    marine[i] = air.heat;
    airHeat[i] = air.heat;
    maritime[i] = air.sea;
    magic[i] = carried[i] + map.ExternalHeatForcing[i] * p.MagicHeatAirShare * (1 - keep);
  }
}
/**
 * Columns march independently; spreading the carried magical heat across the
 * wind keeps a single source from drawing a straight streak.
 */
function spreadAcrossWind(
  map: PhysicalField,
  p: PhysicalProfile,
  carried: Float64Array,
  airHeat: Float64Array
) {
  if (!carried.some((value) => value !== 0)) return;
  const spread = smoothMetric(map.mesh, carried, p.MagicHeatAirSpread);
  for (let i = 0; i < airHeat.length; i++) airHeat[i] += spread[i];
}
interface Air {
  q: number;
  heat: number;
  sea: number;
  orographic: number;
}
/** Air entering at a column's start: saturated over sea, partly humid over land. */
function boundaryAir(map: PhysicalField, p: PhysicalProfile, i: number, target: number): Air {
  return {
    q: target * (ocean(map, i) ? 1 : p.BoundaryColumnHumidity),
    heat: 0,
    sea: Number(ocean(map, i)),
    orographic: 0,
  };
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
  upwindHeight: number,
  air: Air,
  d: number,
  rainout: number
): Air {
  const rise = Math.max(0, height(map, i) - upwindHeight);
  const lifted = air.q * (1 - Math.exp(-rise / p.OrographicLiftHeight));
  const depletion = 1 - Math.exp((-d * rainout) / p.ColumnRainLength);
  return {
    q: (air.q - lifted) * (1 - depletion) + map.Evapotranspiration[i] * 1000 * depletion,
    heat: air.heat * Math.exp(-d / p.AirHeatLength),
    sea: air.sea * Math.exp(-d / p.MaritimeLength),
    orographic: lifted * (p.ColumnRainLength / Math.max(d, Math.sqrt(map.mesh.areas[i]))),
  };
}
