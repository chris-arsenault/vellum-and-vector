import { applyDerivation, isDerivationType } from "./derivation.js";
import { capitalizeWords } from "./utils/helpers.js";

const capitalization: Record<string, (word: string) => string> = {
  cap: (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(),
  lower: (s) => s.toLowerCase(),
  upper: (s) => s.toUpperCase(),
  title: capitalizeWords,
};
const aliases: Record<string, string> = { c: "cap", l: "lower", u: "upper", t: "title" };

function truncate(word: string, modifier: string, rng: () => number) {
  if (word.length <= 3) return word;
  const count = 1 + Math.floor(rng() * Math.min(3, word.length - 2));
  const left = modifier === "chopL" || (modifier === "chop" && rng() > 0.5);
  return left ? word.slice(count) : word.slice(0, -count);
}

/** Grammar casing runs first; token casing overrides it through the reference marker format. */
export function applyModifiers(word: string, modifiers: string[], rng: () => number) {
  let casing = "";
  for (const modifier of modifiers) {
    const cap = aliases[modifier] ?? modifier;
    if (capitalization[cap]) casing = cap;
    else if (isDerivationType(modifier)) word = applyDerivation(word, modifier);
    else if (["chopL", "chopR", "chop"].includes(modifier)) word = truncate(word, modifier, rng);
    else throw new Error(`Unknown NameForge modifier: ${modifier}`);
  }
  return casing ? `\uE000${casing}\uE001${word}\uE002` : word;
}
export function finishCapitalization(word: string) {
  return word.replace(
    /\uE000(cap|lower|upper|title)\uE001([^\uE002]*)\uE002/gi,
    (_, modifier: string, text: string) => capitalization[modifier.toLowerCase()](text)
  );
}
