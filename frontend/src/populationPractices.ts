import type { PopulationGroup } from "@atlas/map";

/**
 * What a group lives by, as shares. The livelihood channels are the ones the support
 * formula yields; together they are a distribution of the group's effort and total at most
 * one. A magic practice is the fraction of the group engaged in it, independent of the
 * others. Any other key is an authored practice kept as a 0..1 weight. Shares are learned
 * from what the community does and spread by contact; nothing assigns them at founding.
 */
export const livelihoodChannels = ["farming", "grazing", "gathering", "fishing"] as const;
export type LivelihoodChannel = (typeof livelihoodChannels)[number];
export type PracticeShares = Record<string, number>;
type PracticeGroup = Pick<PopulationGroup, "practices" | "practiceShares">;

export function isLivelihood(id: string): id is LivelihoodChannel {
  return (livelihoodChannels as readonly string[]).includes(id);
}
/** Earlier sessions named livelihoods after the way of life; they map onto the channel. */
const namedLivelihoods: Record<string, LivelihoodChannel> = {
  cultivation: "farming",
  pastoralism: "grazing",
  foraging: "gathering",
};

/** An authored list is equal livelihood shares and full engagement in anything else. */
export function practiceShares(group: PracticeGroup): PracticeShares {
  if (group.practiceShares) return group.practiceShares;
  const ids = [...new Set(group.practices.map((id) => namedLivelihoods[id] ?? id))];
  const livelihoods = ids.filter(isLivelihood).length;
  return Object.fromEntries(ids.map((id) => [id, isLivelihood(id) ? 1 / livelihoods : 1]));
}
/** A community's practices: its groups' shares weighted by their people. */
export function communityPractices(groups: readonly PopulationGroup[]): PracticeShares {
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const result: PracticeShares = {};
  if (total <= 0) return result;
  for (const group of groups)
    for (const [id, share] of Object.entries(practiceShares(group)))
      if (share > 0) result[id] = (result[id] ?? 0) + share * (group.count / total);
  return result;
}
