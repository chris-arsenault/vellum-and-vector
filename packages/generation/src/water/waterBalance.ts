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
  /** Over the year: what sank to the groundwater, what evaporated, and snow left unmelted. */
  recharge: number;
  evaporated: number;
  keptSnow: number;
  /** What the soil holds and the snow that lies, as means through the year. */
  soil: number;
  snow: number;
}
const emptyYear = (): WaterYear => ({
  quick: [],
  recharge: 0,
  evaporated: 0,
  keptSnow: 0,
  soil: 0,
  snow: 0,
});
interface Stores {
  soil: number;
  snow: number;
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
  const thaw = Math.min(stores.snow + ground.snow[at], Math.max(0, ground.melt[at])),
    storm = ground.rain[at] * ground.stormShare,
    wetting = ground.rain[at] - storm + thaw,
    taken = evaporated(Math.max(0, ground.demand[at]), wetting, stores.soil, ground.soilCapacity),
    held = wetting + stores.soil - taken,
    shed = Math.max(0, held - ground.soilCapacity),
    sinking = shed * ground.sinking;
  stores.snow += ground.snow[at] - thaw;
  stores.soil = held - shed;
  return { quick: storm + shed - sinking, recharge: sinking, evaporated: taken };
}
/**
 * A year of the budget in balance with itself: the stores are run through years until one
 * ends as it began, so a dry-season soil and a winter's snow carry over as they do every year.
 */
export function waterYear(ground: WaterGround): WaterYear {
  const stores: Stores = { soil: 0, snow: 0 };
  let year = emptyYear();
  // Soil and seasonal snow settle within a few years; snow that never melts is kept apart.
  for (let pass = 0; pass < 3; pass++) {
    const before = stores.snow;
    let least = Infinity;
    year = emptyYear();
    for (let at = 0; at < months; at++) {
      const shed = month(ground, at, stores);
      year.quick.push(shed.quick);
      year.recharge += shed.recharge;
      year.evaporated += shed.evaporated;
      year.soil += stores.soil / months;
      year.snow += stores.snow / months;
      least = Math.min(least, stores.snow);
    }
    // The lying snow is the season's cover: what never melted all year is on its way to ice.
    year.snow -= least;
    // Snow lying at the year's end that also lay at its start is the same winter's cover.
    // What a year adds beyond that never melts: it becomes ice and leaves this budget.
    year.keptSnow = Math.max(0, stores.snow - before);
  }
  return year;
}
/**
 * What a river carries through the year, from the flow that reaches it each month: its mean,
 * its greatest and least month, and how many months it carries at least a river's flow.
 */
export function flowThroughYear(monthly: readonly number[], river: number) {
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
