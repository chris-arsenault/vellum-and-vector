import type { PopulationGroup, SocietySupport } from "./society";

/**
 * What a group lives by, as shares. The livelihood channels are the ones the support
 * formula yields; together they are a distribution of the group's effort and total at most
 * one. A magic practice is the fraction of the group engaged in it, independent of the
 * others. Any other key is an authored practice kept as a 0..1 weight. Shares are learned
 * from what the community does and spread by contact; nothing assigns them at founding.
 */
export const livelihoodChannels = ["farming", "grazing", "gathering", "fishing"] as const;
export const magicPracticeChannels = ["fire-forge", "aurora-archive", "pressure-diving"] as const;
export type LivelihoodChannel = (typeof livelihoodChannels)[number];
export type MagicPracticeChannel = (typeof magicPracticeChannels)[number];
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
/** Drop traces, bound every share, keep livelihoods a distribution, and list the result. */
export function withPracticeShares(
  group: PopulationGroup,
  shares: PracticeShares
): PopulationGroup {
  const kept = Object.entries(shares)
    .filter(([, share]) => Number.isFinite(share) && share > 1e-6)
    .map(([id, share]) => [id, Math.min(1, share)] as const);
  const total = kept.filter(([id]) => isLivelihood(id)).reduce((sum, [, s]) => sum + s, 0);
  const scale = total > 1 ? 1 / total : 1;
  const practiceShares = Object.fromEntries(
    kept.map(([id, share]) => [id, isLivelihood(id) ? share * scale : share])
  );
  const practices = Object.keys(practiceShares).sort(
    (a, b) => practiceShares[b] - practiceShares[a] || a.localeCompare(b)
  );
  return { ...group, practices, practiceShares };
}
/** Merge proportional shares; the people in each group weigh its practices. */
export function mergePracticeShares(a: PopulationGroup, b: PopulationGroup): PracticeShares {
  const x = practiceShares(a),
    y = practiceShares(b),
    total = a.count + b.count;
  if (total <= 0) return {};
  const left = a.count / total,
    right = b.count / total;
  const result: PracticeShares = {};
  for (const id of new Set([...Object.keys(x), ...Object.keys(y)]))
    result[id] = (x[id] ?? 0) * left + (y[id] ?? 0) * right;
  return result;
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
/** The livelihoods a country yields, as the distribution a people living from it would have. */
export function livelihoodShares(
  support: Pick<SocietySupport, LivelihoodChannel>
): PracticeShares {
  const total = livelihoodChannels.reduce((sum, id) => sum + Math.max(0, support[id]), 0);
  if (total <= 0) return {};
  return Object.fromEntries(
    livelihoodChannels
      .filter((id) => support[id] > 0)
      .map((id) => [id, Math.max(0, support[id]) / total])
  );
}
/** Move every share part of the way toward its target; absent shares count as zero. */
export function relaxShares(
  current: PracticeShares,
  target: PracticeShares,
  fraction: number
): PracticeShares {
  const result: PracticeShares = {};
  for (const id of new Set([...Object.keys(current), ...Object.keys(target)]))
    result[id] = (current[id] ?? 0) + ((target[id] ?? 0) - (current[id] ?? 0)) * fraction;
  return result;
}
