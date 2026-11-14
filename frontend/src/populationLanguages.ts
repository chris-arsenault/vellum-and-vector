import type { PopulationGroup } from "@atlas/map";

/** Knowledge overlaps; naming use is exclusive. Missing use is unspecified, not extra people. */
export type LanguageShares = Record<string, { knowledge: number; use: number }>;
type LanguageGroup = Pick<PopulationGroup, "languages" | "namingLanguage" | "languageShares">;

/** Simple authored groups can still specify known languages and one naming language. */
export function languageShares(group: LanguageGroup): LanguageShares {
  if (group.languageShares) return group.languageShares;
  const primary =
    group.namingLanguage === undefined ? (group.languages[0] ?? null) : group.namingLanguage;
  return Object.fromEntries(
    group.languages.map((id) => [id, { knowledge: 1, use: Number(id === primary) }])
  );
}
export function languageUse(groups: PopulationGroup[]): Record<string, number> {
  return communityLanguageShares(groups, "use");
}
export function languageKnowledge(groups: PopulationGroup[]): Record<string, number> {
  return communityLanguageShares(groups, "knowledge");
}
function communityLanguageShares(groups: PopulationGroup[], channel: "use" | "knowledge") {
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const result: Record<string, number> = {};
  if (total <= 0) return result;
  for (const group of groups)
    for (const [id, share] of Object.entries(languageShares(group)))
      if (share[channel] > 0)
        result[id] = (result[id] ?? 0) + share[channel] * (group.count / total);
  return result;
}
