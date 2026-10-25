import { mergePopulation, type PopulationGroup } from "@atlas/domain";

/**
 * Merge groups and fold the slivers away. Migration and the draw to centres copy a fraction
 * of every group they move, so without this the groups of a busy community would multiply
 * by cycle and every later pass over them would slow with the age of the world. A group of
 * fewer than one person joins the largest group of the same people, which keeps the count
 * exact; a community of many cultures still keeps every group that is at least a person.
 */
export function compactGroups(groups: PopulationGroup[]): PopulationGroup[] {
  const merged = mergePopulation(groups);
  const slivers = merged.filter((g) => g.count < 1);
  if (!slivers.length) return merged;
  const kept = merged.filter((g) => g.count >= 1);
  for (const sliver of slivers) {
    const host = kept
      .filter((g) => g.people === sliver.people)
      .reduce<PopulationGroup | null>((a, g) => (a && a.count >= g.count ? a : g), null);
    if (host) host.count += sliver.count;
    else kept.push(sliver);
  }
  return kept;
}
