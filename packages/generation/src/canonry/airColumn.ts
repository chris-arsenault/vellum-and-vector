import type { PhysicalField } from "./field";
import { allocateNumerical, type NumericalVector, type NumericalAllocator } from "@atlas/domain";
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
export function sourceOrder(sources: NumericalVector, numerical?: NumericalAllocator) {
  const n = sources.length,
    array = (name: string, type: "uint8" | "int32") =>
      allocateNumerical(
        {
          name: `source-order:${name}`,
          type,
          length: n,
          lifetime: "process",
        },
        numerical
      ),
    state = array("state", "uint8"),
    boundary = array("boundary", "uint8"),
    order = array("order", "int32"),
    path = array("path", "int32");
  let tail = 0;
  for (let start = 0; start < n; start++) {
    if (state[start]) continue;
    let length = 0;
    let current = start;
    while (current >= 0 && state[current] === 0) {
      state[current] = 1;
      path[length++] = current;
      current = sources[current];
    }
    if (current >= 0 && state[current] === 1) boundary[path[length - 1]] = 1;
    for (let k = length - 1; k >= 0; k--) {
      state[path[k]] = 2;
      order[tail++] = path[k];
    }
  }
  numerical?.releaseUnused([state, path], []);
  return { order, boundary };
}
export interface AirColumn {
  moisture: NumericalVector;
  precipitation: NumericalVector;
  airHeat: NumericalVector;
  maritime: NumericalVector;
  /** The storm pulse carried in the column, 0 to 1: the track a sea storm follows inland. */
  storm: NumericalVector;
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
  const p = c.Profile;
  const moisture = workingArray(map, "float64", "air:moisture"),
    precipitation = workingArray(map, "float64", "air:precipitation"),
    airHeat = workingArray(map, "float64", "air:heat"),
    marine = workingArray(map, "float64", "air:marine"),
    maritime = workingArray(map, "float64", "air:maritime"),
    magic = workingArray(map, "float64", "air:magic"),
    carried = workingArray(map, "float64", "air:carried"),
    storm = workingArray(map, "float64", "air:storm");
  const { order, boundary } = sourceOrder(map.UpwindTargets, map.numerical),
    distance = linkDistance(map, p);
  // Wrapped air closes loops around the world; a second pass lets each loop's
  // break read the air that arrived around it instead of a boundary column.
  const passes = wrappedEdges(map, p) ? 2 : 1;
  for (let pass = 0; pass < passes; pass++)
    for (const i of order) {
      const u = boundary[i] && pass === 0 ? -1 : map.UpwindTargets[i];
      advance(i, u);
    }
  spreadAcrossWind(map, p, carried, airHeat);
  releaseWorking(map, marine, magic, carried, order, boundary);
  return { moisture, precipitation, airHeat, maritime, storm };

  function advance(i: number, u: number) {
    const target = saturation(p, map.Temperature[i]) * p.OceanColumnHumidity;
    const d = u < 0 ? 0 : distance(u, i);
    const arriving: Air =
      u < 0
        ? boundaryAir(map, p, i, target)
        : { q: moisture[u], heat: marine[u], sea: maritime[u], orographic: 0 };
    const air = ocean(map, i)
      ? overSea(map, p, i, arriving, d, target)
      : overLand(map, p, i, u, arriving, d, rainout(i));
    steamFromGround(i, d, air, target);
    rideStorm(i, u, d, air, target);
    // Air relaxes toward a share of the forcing beneath it over MagicHeatAirLength,
    // so carried heat depends on distance travelled, not on how many cells it crosses.
    const keep = Math.exp(-(u < 0 ? Math.sqrt(map.mesh.areas[i]) : d) / p.MagicHeatAirLength);
    carried[i] = u < 0 ? 0 : magic[u] * keep;
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
  /** Lift a share of the column's water out as rain on this cell and the next. */
  function wringOut(i: number, d: number, air: Air, share: number) {
    const lifted = air.q * share;
    air.q -= lifted;
    air.orographic += lifted * (p.ColumnRainLength / Math.max(d, Math.sqrt(map.mesh.areas[i])));
  }
  /** Hot ground steams and lifts: the column gains moisture and drops a share of it. */
  function steamFromGround(i: number, d: number, air: Air, target: number) {
    const forcing = map.ExternalHeatForcing[i];
    if (forcing <= 0 || ocean(map, i)) return;
    air.q += Math.max(0, target - air.q) * p.MagicSteamShare * Math.min(1, forcing / 200);
    wringOut(i, d, air, 1 - Math.exp(-forcing / p.MagicLiftHeat));
  }
  /**
   * A storm raised at sea rides the column inland: it relaxes over the storm length, faster
   * where Aurora stills the air (the front is pinned and drops its rain there), pushes the
   * column toward saturation and, over land, wrings out a share of its water as it goes.
   */
  function rideStorm(i: number, u: number, d: number, air: Air, target: number) {
    const pinned = Math.max(
        0,
        1 - Math.max(map.Stillness[i] * p.StormPinning, map.Warding[i] * p.StormDeflection)
      ),
      keepStorm = Math.exp(-(u < 0 ? 0 : d) / p.StormLength) * pinned,
      arriving = u < 0 ? 0 : storm[u] * keepStorm;
    storm[i] = Math.min(1, arriving + map.StormForcing[i] / 1000);
    if (storm[i] <= 0) return;
    air.q += Math.max(0, target - air.q) * p.StormMoistureShare * storm[i];
    if (!ocean(map, i)) wringOut(i, d, air, 1 - Math.exp(-storm[i] / p.StormLift));
  }
}
/**
 * Columns march independently; spreading the carried magical heat across the
 * wind keeps a single source from drawing a straight streak.
 */
function spreadAcrossWind(
  map: PhysicalField,
  p: PhysicalProfile,
  carried: NumericalVector,
  airHeat: NumericalVector
) {
  if (!carried.some((value) => value !== 0)) return;
  const spread = smoothMetric(map.mesh, carried, p.MagicHeatAirSpread, undefined, map.numerical);
  for (let i = 0; i < airHeat.length; i++) airHeat[i] += spread[i];
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
