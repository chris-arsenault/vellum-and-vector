import type {
  Culture,
  GenerateRequest,
  GenerateResult,
  GroupConditions,
  StrategyGroup,
} from "./types/project.js";
import type { GenerationContext } from "./context.js";
import type { MarkovModel, MarkovOptions } from "./markov.js";
import { createRNG, pickWeighted } from "./utils/rng.js";
import { expandGrammar } from "./grammar.js";
import { generatePhonotacticName } from "./phonotactic-pipeline.js";

export interface GeneratorOptions {
  models: ReadonlyMap<string, MarkovModel>;
  markov?: MarkovOptions;
}
function listMatches(values: string[] = [], value = "") {
  return !values.length || values.includes(value);
}
function tagsMatch(conditions: GroupConditions, tags: string[] = []) {
  const expected = conditions.tags ?? [];
  if (!expected.length) return true;
  return conditions.tagMatchAll
    ? expected.every((tag) => tags.includes(tag))
    : expected.some((tag) => tags.includes(tag));
}
function matches(group: StrategyGroup, request: GenerateRequest) {
  const c = group.conditions;
  if (!c) return true;
  return (
    listMatches(c.entityKinds, request.kind) &&
    listMatches(c.subtypes, request.subtype) &&
    listMatches(c.prominence, request.prominence) &&
    tagsMatch(c, request.tags)
  );
}
function specific(group: StrategyGroup) {
  return group.conditions &&
    Object.values(group.conditions).some((v) => Array.isArray(v) && v.length)
    ? 1
    : 0;
}
function select(culture: Culture, request: GenerateRequest) {
  const profile = request.profileId
    ? culture.profiles.find((p) => p.id === request.profileId)
    : (culture.profiles.find((p) => p.entityKinds.includes(request.kind)) ??
      culture.profiles.find((p) => p.isDefault));
  if (!profile) throw new Error(`No NameForge profile for ${culture.id}:${request.kind}`);
  const groups = profile.strategyGroups.filter((g) => matches(g, request));
  groups.sort((a, b) => b.priority - a.priority || specific(b) - specific(a));
  const group = groups[0];
  if (!group?.strategies.length) throw new Error(`No NameForge strategy for ${profile.id}`);
  return group;
}
function single(group: StrategyGroup, ctx: GenerationContext) {
  const strategy = pickWeighted(
    ctx.rng,
    group.strategies,
    group.strategies.map((s) => s.weight)
  );
  ctx.usedMarkov = false;
  if (strategy.type === "grammar") {
    const grammar = ctx.culture.grammars.find((g) => g.id === strategy.grammarId);
    if (!grammar) throw new Error(`Missing NameForge grammar: ${strategy.grammarId}`);
    const name = expandGrammar(grammar, ctx);
    return {
      name,
      strategyUsed: grammar.id,
      strategyType: ctx.usedMarkov ? ("markov" as const) : ("grammar" as const),
    };
  }
  const domain = ctx.culture.domains.find((d) => d.id === strategy.domainId);
  if (!domain) throw new Error(`Missing NameForge domain: ${strategy.domainId}`);
  return {
    name: generatePhonotacticName(ctx.rng, domain),
    strategyUsed: domain.id,
    strategyType: "phonotactic" as const,
  };
}

/** Synchronous, caller-supplied models: safe in both browser workers and Node, with no IO. */
export function generate(
  culture: Culture,
  request: GenerateRequest,
  options: GeneratorOptions
): GenerateResult {
  const count = request.count ?? 1;
  if (!Number.isSafeInteger(count) || count < 1)
    throw new Error("NameForge count must be positive.");
  if (!request.seed) throw new Error("NameForge requires an explicit seed.");
  const group = select(culture, request);
  const ctx: GenerationContext = {
    culture,
    rng: createRNG(request.seed),
    models: options.models,
    userContext: request.context ?? {},
    markovOptions: options.markov ?? {},
    usedMarkov: false,
  };
  const result: GenerateResult = { names: [], strategyUsage: {}, debugInfo: [] };
  for (let i = 0; i < count; i++) {
    const { name, ...debug } = single(group, ctx);
    result.names.push(name);
    result.strategyUsage[debug.strategyType] = (result.strategyUsage[debug.strategyType] ?? 0) + 1;
    result.debugInfo.push({ ...debug, groupUsed: group.name });
  }
  return result;
}
export function generateOne(culture: Culture, request: GenerateRequest, options: GeneratorOptions) {
  return generate(culture, { ...request, count: 1 }, options).names[0];
}
