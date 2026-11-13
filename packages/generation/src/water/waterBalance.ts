/**
 * One water budget for a cell, month by month. Rain wets the soil and snow lies until it is
 * warm enough to melt. The air takes what its warmth can evaporate, from the month's water
 * first and then from what the soil holds. Soil that is full sheds the rest: some runs off the
 * surface and some sinks to the groundwater, by what the ground takes. A share of every rain
 * runs off before it can soak in, however dry the soil, which is what cuts washes in deserts.
 * Depths are millimetres, warmth is degrees above freezing, and a year is twelve equal months.
 *
 * Nothing here is a share-of-the-rain loss. A dry, hot cell sheds almost nothing and a cool,
 * wet one most of its rain, and each does so in its own months.
 */
import { WaterStore } from "./stores";

export const months = 12;

/** The warmth of each month of a year that swings as a sine about its mean; month 0 is coldest. */
export function monthlyWarmth(mean: number, halfRange: number) {
  return Array.from(
    { length: months },
    (_, month) => mean - Math.max(0, halfRange) * Math.cos((2 * Math.PI * month) / months)
  );
}
/**
 * The share of the water supplied to a piece of ground that evaporates over a long run of
 * years, from how the air's demand compares with the supply (Budyko's curve). The monthly
 * bucket is not built from this; it is what the bucket's yearly totals are checked against.
 */
export function evaporatedShare(demand: number, supply: number) {
  if (!(supply > 0)) return 0;
  const aridity = Math.max(0, demand) / supply;
  if (aridity === 0) return 0;
  return Math.min(1, Math.sqrt(aridity * Math.tanh(1 / aridity) * (1 - Math.exp(-aridity))));
}
/**
 * What the air can evaporate in a month at a monthly mean temperature, in millimetres
 * (Hamon's method: 13.97 × days × daylight² × saturated vapour density, with daylight in
 * units of twelve hours). A high latitude's long summer days take more than its warmth
 * alone would. Nothing evaporates from frozen ground.
 */
export function airDemand(celsius: number, daylight = 1) {
  if (!(celsius > 0)) return 0;
  const days = 365.25 / months,
    vapour = (4.95 * Math.exp(0.062 * celsius)) / 100;
  return 13.97 * days * daylight * daylight * vapour;
}
/**
 * The length of the day in units of twelve hours, at a latitude when the sun stands
 * `declination` degrees towards that latitude's pole: 1 at the equator and at the equinox,
 * 0 in the polar night and 2 under the midnight sun (the sunrise equation).
 */
export function dayLength(latitude: number, declination: number) {
  const radians = Math.PI / 180,
    x = -Math.tan(Math.abs(latitude) * radians) * Math.tan(declination * radians);
  return x >= 1 ? 0 : x <= -1 ? 2 : (2 * Math.acos(x)) / Math.PI;
}
/** Where the sun stands in each month, from −1 over the other hemisphere's tropic to 1 over this one's. */
export const sunStanding = (month: number) => -Math.cos((2 * Math.PI * month) / months);
/** What a cell's ground and climate are, as the budget needs them. */
export interface WaterGround {
  /** Per month: rain and snow that fall, and what the air could evaporate. */
  rain: ArrayLike<number>;
  snow: ArrayLike<number>;
  demand: ArrayLike<number>;
  /** Per month: the snow its warmth can melt. */
  melt: ArrayLike<number>;
  /** The water the soil holds when full. */
  soilCapacity: number;
  /** The share of water shed by full soil that sinks to the groundwater, 0 to 1. */
  sinking: number;
  /** The share of each rain that runs off before it can soak in, 0 to 1. */
  stormShare: number;
}
export interface WaterYear {
  /** Per month: what runs off the surface. */
  quick: number[];
  /** Per month: water actually released by thawing the held snow. */
  thaw: number[];
  /** Over the year: what sank to the groundwater, what evaporated, and snow left unmelted. */
  recharge: number;
  evaporated: number;
  keptSnow: number;
  /** What the soil holds and the snow that lies, as means through the year. */
  soil: number;
  snow: number;
  /** Contents left for the next pass, distinct from the typical year's mean presentation. */
  end: { soil: number; snow: number };
}
const emptyYear = (): WaterYear => ({
  quick: [],
  thaw: [],
  recharge: 0,
  evaporated: 0,
  keptSnow: 0,
  soil: 0,
  snow: 0,
  end: { soil: 0, snow: 0 },
});
interface Stores {
  soil: WaterStore;
  snow: WaterStore;
}
/**
 * What the air takes in a month. It takes the month's water first. For what it still lacks it
 * draws on the soil, and soil gives up water less readily the drier it gets: what it holds
 * falls off as the unmet demand mounts against what it can hold (Thornthwaite and Mather), so
 * a soil is drawn down towards empty and never suddenly to it.
 */
export function evaporated(demand: number, wetting: number, soil: number, capacity: number) {
  const met = Math.min(demand, wetting),
    lack = demand - met;
  if (!(lack > 0) || !(soil > 0)) return met;
  return met + (capacity > 0 ? soil * -Math.expm1(-lack / capacity) : soil);
}
/** One month of the budget: the stores as it leaves them, and what it shed. */
function month(ground: WaterGround, at: number, stores: Stores) {
  stores.snow.receive(ground.snow[at]);
  const thaw = stores.snow.give(ground.melt[at]),
    storm = ground.rain[at] * ground.stormShare,
    wetting = ground.rain[at] - storm + thaw,
    met = Math.min(Math.max(0, ground.demand[at]), wetting),
    taken = met + stores.soil.give(Math.max(0, ground.demand[at]) - met),
    shed = stores.soil.drainExcess() + stores.soil.receive(wetting - met),
    sinking = shed * ground.sinking;
  return { quick: storm + shed - sinking, thaw, recharge: sinking, evaporated: taken };
}
/**
 * Unspecified initial stores settle into a typical seasonal year. Supplied contents are
 * actual stocks: they start the returned year's transfers, without being spent in warmup.
 */
export function waterYear(ground: WaterGround, held: Partial<WaterYear["end"]> = {}): WaterYear {
  // Warm unspecified contents first; supplied stocks enter only the returned year's transfers.
  const stores: Stores = {
    soil: new WaterStore(0, ground.soilCapacity, ground.soilCapacity),
    snow: new WaterStore(0, Infinity),
  };
  let year = emptyYear();
  // Soil and seasonal snow settle within a few years; snow that never melts is kept apart.
  for (let pass = 0; pass < 3; pass++) {
    if (pass === 2) restoreSuppliedContents(stores, held);
    const before = stores.snow.held;
    let least = Infinity;
    year = emptyYear();
    for (let at = 0; at < months; at++) {
      const shed = month(ground, at, stores);
      year.quick.push(shed.quick);
      year.thaw.push(shed.thaw);
      year.recharge += shed.recharge;
      year.evaporated += shed.evaporated;
      year.soil += stores.soil.held / months;
      year.snow += stores.snow.held / months;
      least = Math.min(least, stores.snow.held);
    }
    // The lying snow is the season's cover: what never melted all year is on its way to ice.
    year.snow -= least;
    // A year that exhausts its snow can end with the next winter's cover. Keep that cover
    // through warmup; only net accumulation in a year with lying snow throughout becomes ice.
    // The inherited stock is not new accumulation and remains until thaw actually takes it.
    year.keptSnow = least > 0 ? Math.max(0, stores.snow.held - before) : 0;
    stores.snow.give(year.keptSnow);
    year.end = { soil: stores.soil.held, snow: stores.snow.held };
  }
  return year;
}

function restoreSuppliedContents(stores: Stores, held: Partial<WaterYear["end"]>) {
  if (held.soil !== undefined) stores.soil.held = Math.max(0, held.soil);
  if (held.snow !== undefined) stores.snow.held = Math.max(0, held.snow);
}
/**
 * What a river carries through the year, from the flow that reaches it each month: its mean,
 * its greatest and least month, and how many months it carries at least a river's flow.
 */
export function flowThroughYear(
  monthly: Iterable<number> & { readonly length: number },
  river: number
) {
  let least = Infinity,
    greatest = 0,
    total = 0,
    flowing = 0;
  for (const flow of monthly) {
    least = Math.min(least, flow);
    greatest = Math.max(greatest, flow);
    total += flow;
    if (river > 0 && flow >= river) flowing++;
  }
  return {
    perennial: monthly.length ? least : 0,
    flood: greatest,
    mean: monthly.length ? total / monthly.length : 0,
    flowing,
  };
}
