import type { NamingDomain } from "./domain.js";
import type { Capitalization } from "../utils/helpers.js";

/** Runtime subset of Canonry's project format; editor and world-schema data are unnecessary. */
export interface LexemeList {
  id: string;
  entries: string[];
}
export interface Grammar {
  id: string;
  start: string;
  rules: Record<string, string[][]>;
  capitalization: Capitalization;
}
export type Strategy =
  | { type: "grammar"; weight: number; grammarId: string }
  | { type: "phonotactic"; weight: number; domainId: string };
export interface GroupConditions {
  entityKinds?: string[];
  subtypes?: string[];
  prominence?: string[];
  tags?: string[];
  tagMatchAll?: boolean;
}
export interface StrategyGroup {
  name: string;
  /** Higher numeric priorities win, matching both reference runtimes. */
  priority: number;
  conditions: GroupConditions | null;
  strategies: Strategy[];
}
export interface Profile {
  id: string;
  entityKinds: string[];
  isDefault: boolean;
  strategyGroups: StrategyGroup[];
}
export interface Culture {
  id: string;
  name: string;
  description: string;
  domains: NamingDomain[];
  lexemeLists: Record<string, LexemeList>;
  grammars: Grammar[];
  profiles: Profile[];
}
export interface GenerateRequest {
  seed: string;
  kind: string;
  profileId?: string;
  subtype?: string;
  prominence?: string;
  tags?: string[];
  context?: Record<string, string>;
  count?: number;
}
export interface NameDebugInfo {
  groupUsed: string;
  strategyUsed: string;
  strategyType: "grammar" | "markov" | "phonotactic";
}
export interface GenerateResult {
  names: string[];
  strategyUsage: Record<string, number>;
  debugInfo: NameDebugInfo[];
}
