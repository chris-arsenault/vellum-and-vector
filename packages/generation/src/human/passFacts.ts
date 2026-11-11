/**
 * How people act on the land in one pass. A pass is one aggregate act of each operation, sized
 * by the years it stands for; passes repeat, and each reads what the last one left. The loose
 * people of the early epochs and the settled people of a human era run the same operations
 * with different facts.
 */
export interface PassFacts {
  /** The years of living the pass stands for. */
  readonly years: number;
  /** The share of a cell's people who follow the strongest pull in one sweep of gathering. */
  readonly mobility: number;
  /** How often a pass lets people follow the pull, so they can cross more than one cell. */
  readonly sweeps: number;
  /**
   * How far a crowd, a hunger or a surplus is felt along the going, as a share of the map
   * scale's reference length.
   */
  readonly range: number;
  /** Whether people put land under crops and herds. */
  readonly farms: boolean;
  /** Whether people build where they stay. */
  readonly builds: boolean;
}
/** People who live off the wild and move with it: thin on the ground and nowhere for long. */
export const loosePass = (years: number): PassFacts => ({
  years,
  mobility: 0.05,
  sweeps: 1,
  range: 0.005,
  farms: false,
  builds: false,
});
/** People who farm, trade food over distance and build; an era's mobility scales their moving. */
export const settledPass = (years: number, mobility: number): PassFacts => ({
  years,
  mobility: Math.min(0.6, 0.25 * Math.max(0, mobility)),
  sweeps: 3,
  range: 0.03,
  farms: true,
  builds: true,
});
/** How many passes a stretch of settled years is worked in, each reading the last. */
export const passesFor = (years: number) => Math.min(6, Math.max(2, Math.ceil(years / 100)));

/** Per year: how fast people fill what the land feeds. */
export const growthRate = 0.02;
/** Years over which people without food are gone. */
export const hungerYears = 30;
/** How far short of what feeds them people already feel the want of more, as a share. */
export const pressure = 0.25;
/** The share of what worked land grows that its people part with to feed others. */
export const marketShare = 0.2;
/** Years over which land wanted for food is brought under it, and land not wanted goes back. */
export const clearingYears = 50;
/** People a square kilometre of buildings houses. */
export const peoplePerBuiltKm2 = 8000;
/** Years over which people build where they stay, and over which works accumulate. */
export const buildingYears = 50;
export const worksYears = 300;
/** The share of the wild's yield the first people live at. */
export const founders = 0.3;
