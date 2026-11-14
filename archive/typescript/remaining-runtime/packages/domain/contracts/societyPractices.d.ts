import type { PopulationGroup } from "./society";
/**
 * What a group lives by, as shares. The livelihood channels are the ones the support
 * formula yields; together they are a distribution of the group's effort and total at most
 * one. A magic practice is the fraction of the group engaged in it, independent of the
 * others. Any other key is an authored practice kept as a 0..1 weight. Shares are learned
 * from what the community does and spread by contact; nothing assigns them at founding.
 */
export declare const livelihoodChannels: readonly ["farming", "grazing", "gathering", "fishing"];
export declare const magicPracticeChannels: readonly [
  "fire-forge",
  "aurora-archive",
  "pressure-diving",
];
export type LivelihoodChannel = (typeof livelihoodChannels)[number];
export type MagicPracticeChannel = (typeof magicPracticeChannels)[number];
export type PracticeShares = Record<string, number>;
type PracticeGroup = Pick<PopulationGroup, "practices" | "practiceShares">;
export declare function isLivelihood(id: string): id is LivelihoodChannel;
/** An authored list is equal livelihood shares and full engagement in anything else. */
export declare function practiceShares(group: PracticeGroup): PracticeShares;
/** Drop traces, bound every share, keep livelihoods a distribution, and list the result. */
export declare function withPracticeShares(
  group: PopulationGroup,
  shares: PracticeShares
): PopulationGroup;
/** Merge proportional shares; the people in each group weigh its practices. */
export declare function mergePracticeShares(a: PopulationGroup, b: PopulationGroup): PracticeShares;
/** A community's practices: its groups' shares weighted by their people. */
export declare function communityPractices(groups: readonly PopulationGroup[]): PracticeShares;
/** The livelihoods a country yields, as the distribution a people living from it would have. */
export declare function livelihoodShares(
  support: Record<LivelihoodChannel, number>
): PracticeShares;
/** Move every share part of the way toward its target; absent shares count as zero. */
export declare function relaxShares(
  current: PracticeShares,
  target: PracticeShares,
  fraction: number
): PracticeShares;
export {};
