/**
 * How big a waterfall really is, whatever map it is on. Roughly the world's falls with a much longer
 * tail: most are ordinary, more than Earth's share reach Niagara's scale, and a rare few stand well
 * beyond Victoria. Arithmetic only: nothing reads the map.
 */

/** Height in metres at each share of all falls, lowest first; the tail is deliberately long. */
const heights: readonly (readonly [number, number])[] = [
  [0, 3],
  [0.5, 15],
  [0.85, 30],
  [0.93, 50],
  [0.99, 108],
  [0.998, 160],
  [1, 216],
];
/** Metres of crest per root of a cubic metre a second, and the widest crest there is. */
const crestPerFlow = 12,
  widestCrest = 3400;
/** How far a crest runs below and above its usual width. */
const narrowest = 0.6,
  widestShare = 2.4;
/** The most falls one system holds, and how far apart they stand in metres. */
const largestSystem = 40,
  memberSpacing = 1000;
/** The least drop a fall has. */
const leastHeight = 3;

/** A fall's height for a place in the distribution, `roll` in [0, 1). */
export function fallHeight(roll: number) {
  for (let k = 1; k < heights.length; k++) {
    const [fromShare, fromHeight] = heights[k - 1],
      [toShare, toHeight] = heights[k];
    if (roll <= toShare) {
      const t = (roll - fromShare) / (toShare - fromShare);
      return fromHeight * (toHeight / fromHeight) ** t;
    }
  }
  return heights[heights.length - 1][1];
}

/** What bears on a fall's size. */
export interface FallFacts {
  /** The height in metres this stretch of river loses, which the fall or falls spend. */
  budget: number;
  /** Cubic metres a second. */
  discharge: number;
  /** In [0, 1]: how broken the rock is. */
  fracture: number;
}
export interface TrueFallSize {
  height: number;
  width: number;
  /** How far along the river it runs; a single fall's is its own crest. */
  length: number;
  /** One fall, or a system of this many. */
  members: number;
}
/**
 * One drop where rock holds, and a series where broken rock spends the budget in many: a stretch
 * losing far more than one fall's height is a system only as far as its rock is broken. A hard
 * ledge spends the rest as plain steep water.
 */
export function trueFallSize(
  facts: FallFacts,
  heightRoll: number,
  widthRoll: number
): TrueFallSize {
  const budget = Math.max(facts.budget, leastHeight),
    height = Math.min(fallHeight(heightRoll), budget),
    spare = budget / height - 1,
    members = Math.min(largestSystem, 1 + Math.floor(spare * facts.fracture)),
    spread = narrowest + widthRoll * widthRoll * widestShare,
    width = Math.min(widestCrest, crestPerFlow * Math.sqrt(Math.max(0, facts.discharge)) * spread);
  return { height, width, length: (members - 1) * memberSpacing, members };
}
