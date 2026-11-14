import type { GenerationContext } from "./context.js";
import type { Grammar } from "./types/project.js";
import { generateMarkov } from "./markov.js";
import { generatePhonotacticName } from "./phonotactic-pipeline.js";
import { applyCapitalization } from "./utils/helpers.js";
import { pickRandom } from "./utils/rng.js";
import { applyModifiers, finishCapitalization } from "./modifiers.js";

const prefix = /(slot:|domain:|markov:|context:)/;

function reference(pattern: string, ctx: GenerationContext): string {
  const separator = pattern.indexOf(":"),
    type = pattern.slice(0, separator),
    id = pattern.slice(separator + 1);
  const handlers: Record<string, () => string> = {
    slot: () => {
      const list = ctx.culture.lexemeLists[id];
      if (!list?.entries.length) throw new Error(`Missing NameForge lexeme list: ${id}`);
      return pickRandom(ctx.rng, list.entries);
    },
    domain: () => {
      const domain = ctx.culture.domains.find((d) => d.id === id);
      if (!domain) throw new Error(`Missing NameForge domain: ${id}`);
      return generatePhonotacticName(ctx.rng, domain);
    },
    markov: () => {
      const model = ctx.models.get(id);
      if (!model) throw new Error(`Missing NameForge Markov model: ${id}`);
      ctx.usedMarkov = true;
      return generateMarkov(model, ctx.rng, ctx.markovOptions);
    },
    context: () => {
      if (!ctx.userContext[id]) throw new Error(`Missing NameForge context: ${id}`);
      return ctx.userContext[id];
    },
  };
  return handlers[type] ? handlers[type]() : pattern;
}
function segment(token: string, ctx: GenerationContext) {
  const start = token.search(prefix);
  if (start < 0) return token;
  const [pattern, ...modifiers] = token.slice(start).split("~");
  return token.slice(0, start) + applyModifiers(reference(pattern, ctx), modifiers, ctx.rng);
}
function terminal(token: string, ctx: GenerationContext) {
  // Split the legacy joined-reference notation, preserving hyphens inside IDs.
  return token
    .split(/-(?=(?:slot|domain|markov|context):)/)
    .map((part) =>
      part
        .split("^")
        .map((s) => segment(s, ctx))
        .join("")
    )
    .join("-");
}
function hasContext(tokens: string[], ctx: GenerationContext) {
  return tokens.every((token) =>
    [...token.matchAll(/context:([\w-]+)/g)].every((match) => Boolean(ctx.userContext[match[1]]))
  );
}
function expand(symbol: string, grammar: Grammar, ctx: GenerationContext, depth: number): string {
  if (depth > 10) throw new Error(`Recursive NameForge grammar: ${grammar.id}`);
  const productions = grammar.rules[symbol];
  if (!productions) return terminal(symbol, ctx);
  const candidates = productions.filter((p) => hasContext(p, ctx));
  if (!candidates.length) throw new Error(`No usable production in ${grammar.id}:${symbol}`);
  return pickRandom(ctx.rng, candidates)
    .map((token) => expand(token, grammar, ctx, depth + 1))
    .join(" ")
    .trim();
}
export function expandGrammar(grammar: Grammar, ctx: GenerationContext) {
  const raw = expand(grammar.start, grammar, ctx, 0);
  const styled =
    grammar.capitalization === "mixed" ? raw : applyCapitalization(raw, grammar.capitalization);
  return finishCapitalization(styled);
}
