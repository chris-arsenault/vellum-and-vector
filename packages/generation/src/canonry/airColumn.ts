import type { PhysicalField } from "./field";
import type { Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { toUnits } from "./math";
import { smoothMetric } from "./metricSmoothing";
import { linkDistance, wrappedEdges } from "./longitudeWrap";

/** Saturation moisture of a column at a native temperature (ten units per °C, 0 °C at 300). */
export function saturation(p: PhysicalProfile, temperature: number) {
  return p.ColumnSaturation * Math.exp(p.ColumnSaturationGrowth * ((temperature - 300) / 10 - 20));
}
/**
 * Cells ordered so that each follows its single source (upwind air or
 * upstream water). A closed loop is broken at the cell that entered it last,
 * which then starts from boundary values.
 */
export function sourceOrder(map: PhysicalField, sources: Band) {
  const n = sources.length,
    state = workingArray(map, "uint8", "source-order:state", n),
    path = workingArray(map, "int32", "source-order:path", n),
    boundary = workingArray(map, "uint8", "source-order:boundary", n),
    order = workingArray(map, "int32", "source-order:order", n);
  let tail = 0;
  for (let start = 0; start < n; start++) {
    if (state.get(start)) continue;
    let length = 0;
    let current = start;
    while (current >= 0 && state.get(current) === 0) {
      state.set(current, 1);
      path.set(length++, current);
      current = sources.get(current);
    }
    if (current >= 0 && state.get(current) === 1) boundary.set(path.get(length - 1), 1);
    for (let k = length - 1; k >= 0; k--) {
      const cell = path.get(k);
      state.set(cell, 2);
      order.set(tail++, cell);
    }
  }
  releaseWorking(map, state, path);
  return { order, boundary };
}
export interface AirColumn {
  moisture: Band;
  precipitation: Band;
  airHeat: Band;
  maritime: Band;
  /** The storm pulse carried in the column, 0 to 1: the track a sea storm follows inland. */
  storm: Band;
}
const ocean = (map: PhysicalField, i: number) => map.WaterKindCodes.get(i) === 1;
function height(map: PhysicalField, i: number) {
  return ocean(map, i) ? 0 : Math.max(0, toUnits(map.Elevation.get(i) - map.EffectiveSeaLevel));
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
  const p = c.Profile;
  const [moisture, precipitation, airHeat, marine, maritime, magic, carried, storm] = [
    "moisture",
    "precipitation",
    "heat",
    "marine",
    "maritime",
    "magic",
    "carried",
    "storm",
  ].map((name) => workingArray(map, "float64", `air:${name}`));
  const { order, boundary } = sourceOrder(map, map.UpwindTargets),
    distance = linkDistance(map, p);
  // Wrapped air closes loops around the world; a second pass lets each loop's
  // break read the air that arrived around it instead of a boundary column.
  const passes = wrappedEdges(map, p) ? 2 : 1;
  for (let pass = 0; pass < passes; pass++)
    for (let n = 0; n < order.length; n++) {
      const i = order.get(n),
        u = boundary.get(i) && pass === 0 ? -1 : map.UpwindTargets.get(i);
      advance(i, u);
    }
  spreadAcrossWind(map, p, carried, airHeat);
  releaseWorking(map, marine, magic, carried, order, boundary);
  return { moisture, precipitation, airHeat, maritime, storm };

  function advance(i: number, u: number) {
    const target = saturation(p, map.Temperature.get(i)) * p.OceanColumnHumidity;
    const d = u < 0 ? 0 : distance(u, i);
    const arriving: Air =
      u < 0
        ? boundaryAir(map, p, i, target)
        : { q: moisture.get(u), heat: marine.get(u), sea: maritime.get(u), orographic: 0 };
    const air = ocean(map, i)
      ? overSea(map, p, i, arriving, d, target)
      : overLand(map, p, i, u, arriving, d, rainout(i));
    steamFromGround(map, p, i, d, air, target);
    rideStorm(i, u, d, air, target);
    // Air relaxes toward a share of the forcing beneath it over MagicHeatAirLength,
    // so carried heat depends on distance travelled, not on how many cells it crosses.
    const keep = Math.exp(-(u < 0 ? Math.sqrt(map.mesh.area(i)) : d) / p.MagicHeatAirLength);
    const carriedHeat = u < 0 ? 0 : magic.get(u) * keep;
    carried.set(i, carriedHeat);
    const q = Math.max(0, air.q);
    moisture.set(i, q);
    // Subsiding air under the subtropical and polar highs also caps uplift rain.
    const belt = rainout(i);
    precipitation.set(i, p.ColumnRainEfficiency * (belt * q + Math.min(1, belt) * air.orographic));
    marine.set(i, air.heat);
    airHeat.set(i, air.heat);
    maritime.set(i, air.sea);
    magic.set(i, carriedHeat + map.ExternalHeatForcing.get(i) * p.MagicHeatAirShare * (1 - keep));
  }
  /**
   * A storm raised at sea rides the column inland: it relaxes over the storm length, faster
   * where Aurora stills the air (the front is pinned and drops its rain there), pushes the
   * column toward saturation and, over land, wrings out a share of its water as it goes.
   */
  function rideStorm(i: number, u: number, d: number, air: Air, target: number) {
    const pinned = Math.max(
        0,
        1 - Math.max(map.Stillness.get(i) * p.StormPinning, map.Warding.get(i) * p.StormDeflection)
      ),
      keepStorm = Math.exp(-(u < 0 ? 0 : d) / p.StormLength) * pinned,
      arriving = u < 0 ? 0 : storm.get(u) * keepStorm,
      pulse = Math.min(1, arriving + map.StormForcing.get(i) / 1000);
    storm.set(i, pulse);
    if (pulse <= 0) return;
    air.q += Math.max(0, target - air.q) * p.StormMoistureShare * pulse;
    if (!ocean(map, i)) wringOut(map, p, i, d, air, 1 - Math.exp(-pulse / p.StormLift));
  }
}
/** Lift a share of the column's water out as rain on this cell and the next. */
function wringOut(
  map: PhysicalField,
  p: PhysicalProfile,
  i: number,
  d: number,
  air: Air,
  share: number
) {
  const lifted = air.q * share;
  air.q -= lifted;
  air.orographic += lifted * (p.ColumnRainLength / Math.max(d, Math.sqrt(map.mesh.area(i))));
}
/** Hot ground steams and lifts: the column gains moisture and drops a share of it. */
function steamFromGround(
  map: PhysicalField,
  p: PhysicalProfile,
  i: number,
  d: number,
  air: Air,
  target: number
) {
  const forcing = map.ExternalHeatForcing.get(i);
  if (forcing <= 0 || ocean(map, i)) return;
  air.q += Math.max(0, target - air.q) * p.MagicSteamShare * Math.min(1, forcing / 200);
  wringOut(map, p, i, d, air, 1 - Math.exp(-forcing / p.MagicLiftHeat));
}
/**
 * Columns march independently; spreading the carried magical heat across the
 * wind keeps a single source from drawing a straight streak.
 */
function spreadAcrossWind(map: PhysicalField, p: PhysicalProfile, carried: Band, airHeat: Band) {
  let any = false;
  for (let i = 0; i < carried.length && !any; i++) if (carried.get(i) !== 0) any = true;
  if (!any) return;
  const spread = smoothMetric(map, carried, p.MagicHeatAirSpread);
  for (let i = 0; i < airHeat.length; i++) airHeat.add(i, spread.get(i));
  releaseWorking(map, spread);
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
    heat: air.heat + (map.SeaSurfaceAnomaly.get(i) - air.heat) * exchange,
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
    q: (air.q - lifted) * (1 - depletion) + map.Evapotranspiration.get(i) * 1000 * depletion,
    heat: air.heat * Math.exp(-d / p.AirHeatLength),
    sea: air.sea * Math.exp(-d / p.MaritimeLength),
    orographic: lifted * (p.ColumnRainLength / Math.max(d, Math.sqrt(map.mesh.area(i)))),
  };
}
