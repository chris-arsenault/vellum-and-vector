import { MapScale } from "@atlas/domain";
/**
 * How big a waterfall really is, whatever map it is on. Roughly the world's falls with a much longer
 * tail: most are ordinary, more than Earth's share reach Niagara's scale, and a rare few stand well
 * beyond Victoria at the reference extent. The owning map resolves every generated dimension.
 */

/** Relative height at each share of all falls, lowest first; the tail is deliberately long. */
const heights: readonly (readonly [number, number])[] = [
  [0, 0.00000075],
  [0.5, 0.00000375],
  [0.85, 0.0000075],
  [0.93, 0.0000125],
  [0.99, 0.000027],
  [0.998, 0.00004],
  [1, 0.000054],
];
/** Metres of crest per root of a cubic metre a second, and the widest crest there is. */
const crestPerFlow = MapScale.measure(24000, -0.5),
  widestCrest = 0.00085;
/** How far a crest runs below and above its usual width. */
const narrowest = 0.6,
  widestShare = 2.4;
/** The most falls one system holds, and how far apart they stand in metres. */
const largestSystem = 40,
  // length-unit: fraction
  memberSpacing = 0.00025;
/** The least drop a fall has. */
// length-unit: fraction
const leastHeight = 0.00000075;

/** A fall's height for a place in the distribution, `roll` in [0, 1). */
export function fallHeight(roll: number, scale: MapScale) {
  for (let k = 1; k < heights.length; k++) {
    const [fromShare, fromHeight] = heights[k - 1],
      [toShare, toHeight] = heights[k];
    if (roll <= toShare) {
      const t = (roll - fromShare) / (toShare - fromShare);
      return scale.length(fromHeight * (toHeight / fromHeight) ** t, 0.5);
    }
  }
  return scale.length(heights[heights.length - 1][1], 0.5);
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
  widthRoll: number,
  scale: MapScale
): TrueFallSize {
  const budget = Math.max(facts.budget, scale.length(leastHeight, 0.5)),
    height = Math.min(fallHeight(heightRoll, scale), budget),
    spare = budget / height - 1,
    members = Math.min(largestSystem, 1 + Math.floor(spare * facts.fracture)),
    spread = narrowest + widthRoll * widthRoll * widestShare,
    width = Math.min(
      scale.length(widestCrest),
      scale.resolveMeasure(crestPerFlow) * Math.sqrt(Math.max(0, facts.discharge)) * spread
    );
  return { height, width, length: (members - 1) * scale.length(memberSpacing), members };
}
