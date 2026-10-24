import { communityPractices, type PopulationGroup } from "@atlas/domain";

/**
 * The shares raise the yield. A full share adds half again to its channel, per channel and
 * bounded, so concentration pays through yield while a people living by several channels
 * loses nothing on any of them. Geography still sets the base the factor multiplies.
 */
export const practiceYieldGain = 0.5;
/** A community's skill in each channel, as the factor its practice share earns. */
export function practiceSkill(groups: readonly PopulationGroup[]) {
  const shares = communityPractices(groups);
  return (id: string) => 1 + practiceYieldGain * (shares[id] ?? 0);
}
