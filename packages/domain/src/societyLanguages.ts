import type { PopulationGroup } from "./society";

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
export function primaryNamingLanguage(group: LanguageGroup) {
  return (
    Object.entries(languageShares(group))
      .filter(([, share]) => share.use > 0)
      .sort(([a, x], [b, y]) => y.use - x.use || a.localeCompare(b))[0]?.[0] ?? null
  );
}
export function withLanguageShares(
  group: PopulationGroup,
  shares: LanguageShares
): PopulationGroup {
  const languageShares = Object.fromEntries(
    Object.entries(shares)
      .filter(([, s]) => s.knowledge > 0)
      .map(([id, s]) => [
        id,
        { knowledge: Math.min(1, s.knowledge), use: Math.min(1, s.knowledge, s.use) },
      ])
  );
  const updated = { ...group, languages: Object.keys(languageShares), languageShares };
  return { ...updated, namingLanguage: primaryNamingLanguage(updated) };
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
/** Merge proportional language counts while retaining the other demographic affiliations. */
export function mergeLanguageShares(a: PopulationGroup, b: PopulationGroup): LanguageShares {
  const x = languageShares(a),
    y = languageShares(b),
    total = a.count + b.count;
  const left = a.count / total,
    right = b.count / total;
  const result: LanguageShares = {};
  for (const id of new Set([...Object.keys(x), ...Object.keys(y)]))
    result[id] = {
      knowledge: (x[id]?.knowledge ?? 0) * left + (y[id]?.knowledge ?? 0) * right,
      use: (x[id]?.use ?? 0) * left + (y[id]?.use ?? 0) * right,
    };
  return result;
}
