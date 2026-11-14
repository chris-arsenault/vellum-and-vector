import type { PopulationGroup } from "./society";
/** Knowledge overlaps; naming use is exclusive. Missing use is unspecified, not extra people. */
export type LanguageShares = Record<
  string,
  {
    knowledge: number;
    use: number;
  }
>;
type LanguageGroup = Pick<PopulationGroup, "languages" | "namingLanguage" | "languageShares">;
/** Simple authored groups can still specify known languages and one naming language. */
export declare function languageShares(group: LanguageGroup): LanguageShares;
export declare function primaryNamingLanguage(group: LanguageGroup): string;
export declare function withLanguageShares(
  group: PopulationGroup,
  shares: LanguageShares
): PopulationGroup;
export declare function languageUse(groups: PopulationGroup[]): Record<string, number>;
export declare function languageKnowledge(groups: PopulationGroup[]): Record<string, number>;
/** Merge proportional language counts while retaining the other demographic affiliations. */
export declare function mergeLanguageShares(a: PopulationGroup, b: PopulationGroup): LanguageShares;
export {};
