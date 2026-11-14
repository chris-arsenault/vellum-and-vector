/**
 * Rule-based morphological derivations for English words
 *
 * Transforms base words into derived forms:
 * - Agentive (-er): one who does X (hunt → hunter, rend → render)
 * - Superlative (-est): most X (deep → deepest, grim → grimmest)
 * - Comparative (-er): more X (dark → darker)
 * - Gerund (-ing): X-ing (burn → burning, forge → forging)
 * - Past (-ed): X-ed (curse → cursed, hunt → hunted)
 * - Possessive ('s): X's (storm → storm's)
 */

// Common irregular forms lookup
const IRREGULAR_PAST: Record<string, string> = {
  // Strong verbs
  break: "broken",
  speak: "spoken",
  wake: "woken",
  take: "taken",
  shake: "shaken",
  forsake: "forsaken",
  // Vowel changes
  sing: "sung",
  ring: "rung",
  drink: "drunk",
  sink: "sunk",
  shrink: "shrunk",
  stink: "stunk",
  swim: "swum",
  begin: "begun",
  // -ought/-aught
  bring: "brought",
  buy: "bought",
  catch: "caught",
  fight: "fought",
  seek: "sought",
  teach: "taught",
  think: "thought",
  // Other irregulars
  bear: "borne",
  bite: "bitten",
  blow: "blown",
  choose: "chosen",
  draw: "drawn",
  drive: "driven",
  eat: "eaten",
  fall: "fallen",
  fly: "flown",
  freeze: "frozen",
  give: "given",
  grow: "grown",
  hide: "hidden",
  know: "known",
  ride: "ridden",
  rise: "risen",
  see: "seen",
  slay: "slain",
  smite: "smitten",
  steal: "stolen",
  strike: "stricken",
  swear: "sworn",
  tear: "torn",
  throw: "thrown",
  wear: "worn",
  weave: "woven",
  write: "written",
  // Same form
  cut: "cut",
  hit: "hit",
  hurt: "hurt",
  put: "put",
  set: "set",
  shed: "shed",
  shut: "shut",
  split: "split",
  spread: "spread",
  thrust: "thrust",
  // -t endings
  bend: "bent",
  build: "built",
  burn: "burnt",
  deal: "dealt",
  dream: "dreamt",
  dwell: "dwelt",
  feel: "felt",
  keep: "kept",
  kneel: "knelt",
  lean: "leant",
  leap: "leapt",
  learn: "learnt",
  leave: "left",
  lend: "lent",
  lose: "lost",
  mean: "meant",
  meet: "met",
  send: "sent",
  sleep: "slept",
  smell: "smelt",
  spell: "spelt",
  spend: "spent",
  spill: "spilt",
  sweep: "swept",
  weep: "wept",
  // Special
  be: "been",
  do: "done",
  go: "gone",
  have: "had",
  make: "made",
  say: "said",
  hold: "held",
  stand: "stood",
  find: "found",
  bind: "bound",
  grind: "ground",
  wind: "wound",
  hang: "hung",
  dig: "dug",
  stick: "stuck",
  spin: "spun",
  win: "won",
  cling: "clung",
  fling: "flung",
  sling: "slung",
  sting: "stung",
  swing: "swung",
  wring: "wrung",
};

// Irregular agentives (where simple -er doesn't work well)
const IRREGULAR_AGENTIVE: Record<string, string> = {
  lie: "liar",
  die: "death-dealer", // or skip
  sing: "singer", // regular but included for completeness
  slay: "slayer",
};

// Irregular superlatives
const IRREGULAR_SUPERLATIVE: Record<string, string> = {
  good: "best",
  bad: "worst",
  far: "farthest",
  little: "least",
  much: "most",
  many: "most",
};

// Irregular comparatives
const IRREGULAR_COMPARATIVE: Record<string, string> = {
  good: "better",
  bad: "worse",
  far: "farther",
  little: "less",
  much: "more",
  many: "more",
};

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/**
 * Check if a character is a vowel
 */
function isVowel(char: string): boolean {
  return VOWELS.has(char.toLowerCase());
}

/**
 * Check if a character is a consonant
 */
function isConsonant(char: string): boolean {
  return /[a-z]/i.test(char) && !isVowel(char);
}

/**
 * Check if word ends in CVC pattern (consonant-vowel-consonant)
 * where we should double the final consonant
 */
function shouldDoubleConsonant(word: string): boolean {
  if (word.length < 3) return false;

  const last = word[word.length - 1].toLowerCase();
  const secondLast = word[word.length - 2].toLowerCase();
  const thirdLast = word[word.length - 3].toLowerCase();

  // Don't double w, x, y
  if (["w", "x", "y"].includes(last)) return false;

  // Must end in CVC
  if (!isConsonant(last)) return false;
  if (!isVowel(secondLast)) return false;
  if (!isConsonant(thirdLast)) return false;

  // For longer words, only double if stress is on final syllable
  // Heuristic: single-syllable words or words ending in certain patterns
  if (word.length <= 4) return true;

  // Common stressed endings
  const stressedEndings = ["mit", "gin", "fer", "cur", "pel", "quet"];
  for (const ending of stressedEndings) {
    if (word.toLowerCase().endsWith(ending)) return true;
  }

  return false;
}

/**
 * Apply agentive transformation: one who does X
 * hunt → hunter, forge → forger, rend → render, cut → cutter
 */
export function agentive(word: string): string {
  const lower = word.toLowerCase();

  // Check irregulars
  if (IRREGULAR_AGENTIVE[lower]) {
    return matchCase(word, IRREGULAR_AGENTIVE[lower]);
  }

  // Ends in 'e' - just add 'r'
  if (lower.endsWith("e")) {
    return word + "r";
  }

  // Ends in 'y' after consonant - change to 'ier'
  if (lower.endsWith("y") && word.length > 1 && isConsonant(lower[lower.length - 2])) {
    return word.slice(0, -1) + "ier";
  }

  // CVC pattern - double final consonant
  if (shouldDoubleConsonant(word)) {
    return word + word[word.length - 1] + "er";
  }

  // Default: add 'er'
  return word + "er";
}

/**
 * Apply superlative transformation: most X
 * deep → deepest, grim → grimmest, pale → palest
 */
export function superlative(word: string): string {
  const lower = word.toLowerCase();

  // Check irregulars
  if (IRREGULAR_SUPERLATIVE[lower]) {
    return matchCase(word, IRREGULAR_SUPERLATIVE[lower]);
  }

  // Ends in 'e' - just add 'st'
  if (lower.endsWith("e")) {
    return word + "st";
  }

  // Ends in 'y' after consonant - change to 'iest'
  if (lower.endsWith("y") && word.length > 1 && isConsonant(lower[lower.length - 2])) {
    return word.slice(0, -1) + "iest";
  }

  // CVC pattern - double final consonant
  if (shouldDoubleConsonant(word)) {
    return word + word[word.length - 1] + "est";
  }

  // Default: add 'est'
  return word + "est";
}

/**
 * Apply comparative transformation: more X
 * dark → darker, swift → swifter
 */
export function comparative(word: string): string {
  const lower = word.toLowerCase();

  // Check irregulars
  if (IRREGULAR_COMPARATIVE[lower]) {
    return matchCase(word, IRREGULAR_COMPARATIVE[lower]);
  }

  // Same rules as superlative but with 'er'
  if (lower.endsWith("e")) {
    return word + "r";
  }

  if (lower.endsWith("y") && word.length > 1 && isConsonant(lower[lower.length - 2])) {
    return word.slice(0, -1) + "ier";
  }

  if (shouldDoubleConsonant(word)) {
    return word + word[word.length - 1] + "er";
  }

  return word + "er";
}

/**
 * Apply gerund/present participle transformation: X-ing
 * burn → burning, forge → forging, run → running
 */
export function gerund(word: string): string {
  const lower = word.toLowerCase();

  // Ends in 'ie' - change to 'ying'
  if (lower.endsWith("ie")) {
    return word.slice(0, -2) + "ying";
  }

  // Ends in 'e' (but not 'ee') - drop 'e' and add 'ing'
  if (lower.endsWith("e") && !lower.endsWith("ee")) {
    return word.slice(0, -1) + "ing";
  }

  // CVC pattern - double final consonant
  if (shouldDoubleConsonant(word)) {
    return word + word[word.length - 1] + "ing";
  }

  // Default: add 'ing'
  return word + "ing";
}

/**
 * Apply past/passive transformation: X-ed
 * curse → cursed, hunt → hunted, cut → cut
 */
export function past(word: string): string {
  const lower = word.toLowerCase();

  // Check irregulars first
  if (IRREGULAR_PAST[lower]) {
    return matchCase(word, IRREGULAR_PAST[lower]);
  }

  // Ends in 'e' - just add 'd'
  if (lower.endsWith("e")) {
    return word + "d";
  }

  // Ends in 'y' after consonant - change to 'ied'
  if (lower.endsWith("y") && word.length > 1 && isConsonant(lower[lower.length - 2])) {
    return word.slice(0, -1) + "ied";
  }

  // CVC pattern - double final consonant
  if (shouldDoubleConsonant(word)) {
    return word + word[word.length - 1] + "ed";
  }

  // Default: add 'ed'
  return word + "ed";
}

/**
 * Apply possessive transformation: X's
 * storm → storm's, darkness → darkness'
 */
export function possessive(word: string): string {
  const lower = word.toLowerCase();

  // Ends in 's' or 'x' or 'z' - just add apostrophe
  if (lower.endsWith("s") || lower.endsWith("x") || lower.endsWith("z")) {
    return word + "'";
  }

  // Default: add 's
  return word + "'s";
}

/**
 * Match the case pattern of the source word to the result
 */
function matchCase(source: string, result: string): string {
  if (source === source.toUpperCase()) {
    return result.toUpperCase();
  }
  if (source[0] === source[0].toUpperCase()) {
    return result[0].toUpperCase() + result.slice(1);
  }
  return result;
}

/**
 * Apply a derivation by name
 */
export function applyDerivation(
  word: string,
  derivationType: "er" | "est" | "ing" | "ed" | "poss" | "comp"
): string {
  switch (derivationType) {
    case "er":
      return agentive(word);
    case "est":
      return superlative(word);
    case "comp":
      return comparative(word);
    case "ing":
      return gerund(word);
    case "ed":
      return past(word);
    case "poss":
      return possessive(word);
    default:
      return word;
  }
}

/**
 * List of supported derivation types
 */
export const DERIVATION_TYPES = ["er", "est", "ing", "ed", "poss", "comp"] as const;
export type DerivationType = (typeof DERIVATION_TYPES)[number];

/**
 * Check if a string is a valid derivation type
 */
export function isDerivationType(s: string): s is DerivationType {
  return DERIVATION_TYPES.includes(s as DerivationType);
}
