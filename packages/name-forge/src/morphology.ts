import type { MorphologyProfile } from "./types/domain.js";
import { pickWeighted, pickRandom } from "./utils/rng.js";

interface MorphState {
  result: string;
  parts: string[];
  syllables: string[];
}

function applyRootToken(state: MorphState, root: string, rootSyllables: string[]): void {
  state.result += root;
  state.parts.push(`root:${root}`);
  if (rootSyllables.length > 0) {
    state.syllables.push(...rootSyllables);
  } else {
    state.syllables.push(root);
  }
}

function applyPrefixToken(state: MorphState, rng: () => number, profile: MorphologyProfile): void {
  if (!profile.prefixes || profile.prefixes.length === 0) return;
  const prefix = pickWeighted(rng, profile.prefixes, profile.prefixWeights ?? []);
  state.result += prefix;
  state.parts.push(`prefix:${prefix}`);
  state.syllables.push(prefix);
}

function applySuffixToken(state: MorphState, rng: () => number, profile: MorphologyProfile): void {
  if (!profile.suffixes || profile.suffixes.length === 0) return;
  const suffix = pickWeighted(rng, profile.suffixes, profile.suffixWeights ?? []);
  state.result += suffix;
  state.parts.push(`suffix:${suffix}`);
  state.syllables.push(suffix);
}

function applyInfixToken(
  state: MorphState,
  rng: () => number,
  profile: MorphologyProfile,
  root: string
): void {
  if (!profile.infixes || profile.infixes.length === 0 || root.length <= 2) return;
  const infix = pickRandom(rng, profile.infixes);
  const mid = Math.floor(root.length / 2);
  state.result = state.result.slice(0, -root.length) + root.slice(0, mid) + infix + root.slice(mid);
  state.parts.push(`infix:${infix}`);
}

function applyWordrootToken(
  state: MorphState,
  rng: () => number,
  profile: MorphologyProfile,
  root: string,
  rootSyllables: string[]
): void {
  if (profile.wordRoots && profile.wordRoots.length > 0) {
    const wordRoot = pickRandom(rng, profile.wordRoots);
    state.result += wordRoot;
    state.parts.push(`wordroot:${wordRoot}`);
    state.syllables.push(wordRoot);
  } else {
    applyRootToken(state, root, rootSyllables);
  }
}

function applyHonorificToken(
  state: MorphState,
  rng: () => number,
  profile: MorphologyProfile
): void {
  if (!profile.honorifics || profile.honorifics.length === 0) return;
  const honorific = pickRandom(rng, profile.honorifics);
  state.result = honorific + " " + state.result;
  state.parts.push(`honorific:${honorific}`);
}

/**
 * Apply morphological structure to a base word (root)
 * @param rootSyllables - Original syllables from phonology (used to track syllable boundaries)
 */
export function applyMorphology(
  rng: () => number,
  root: string,
  profile: MorphologyProfile,
  rootSyllables: string[]
): { result: string; structure: string; parts: string[]; syllables: string[] } {
  const structure = pickWeighted(rng, profile.structure, profile.structureWeights ?? []);
  const state: MorphState = { result: "", parts: [], syllables: [] };
  const tokens = structure.split("-");

  for (const token of tokens) {
    switch (token) {
      case "root":
        applyRootToken(state, root, rootSyllables);
        break;
      case "prefix":
        applyPrefixToken(state, rng, profile);
        break;
      case "suffix":
        applySuffixToken(state, rng, profile);
        break;
      case "infix":
        applyInfixToken(state, rng, profile, root);
        break;
      case "wordroot":
        applyWordrootToken(state, rng, profile, root, rootSyllables);
        break;
      case "honorific":
        applyHonorificToken(state, rng, profile);
        break;
      default:
        break;
    }
  }

  return { result: state.result, structure, parts: state.parts, syllables: state.syllables };
}

/**
 * Apply morphology with multiple candidates and pick best
 * Useful for avoiding overly long or awkward combinations
 * @param rootSyllables - Original syllables from phonology (used to track syllable boundaries)
 */
export function applyMorphologyBest(
  rng: () => number,
  root: string,
  profile: MorphologyProfile,
  candidateCount: number = 3,
  maxLength: number = 20,
  rootSyllables: string[]
): { result: string; structure: string; parts: string[]; syllables: string[] } {
  const candidates: {
    result: string;
    structure: string;
    parts: string[];
    syllables: string[];
    score: number;
  }[] = [];

  for (let i = 0; i < candidateCount; i++) {
    const morphed = applyMorphology(rng, root, profile, rootSyllables);

    // Score based on length (prefer moderate length)
    let score = 1.0;
    if (morphed.result.length > maxLength) {
      score *= 0.5; // Penalize overly long names
    }
    if (morphed.result.length < 3) {
      score *= 0.5; // Penalize overly short names
    }

    candidates.push({ ...morphed, score });
  }

  // Pick weighted by score
  const scores = candidates.map((c) => c.score);
  const totalScore = scores.reduce((sum, s) => sum + s, 0);

  const r = rng() * totalScore;
  let cumulative = 0;
  for (const candidate of candidates) {
    cumulative += candidate.score;
    if (r < cumulative) {
      return {
        result: candidate.result,
        structure: candidate.structure,
        parts: candidate.parts,
        syllables: candidate.syllables,
      };
    }
  }

  // Fallback
  return {
    result: candidates[0].result,
    structure: candidates[0].structure,
    parts: candidates[0].parts,
    syllables: candidates[0].syllables,
  };
}

/**
 * Check if a morphology profile can actually modify names
 * (i.e., has at least some affixes or structures beyond "root")
 */
export function canApplyMorphology(profile: MorphologyProfile): boolean {
  // Check if there are any non-root structures
  const hasComplexStructures = profile.structure.some((s) => s !== "root" && s.includes("-"));

  if (!hasComplexStructures) {
    return false;
  }

  // Check if there are any affixes available
  const hasAffixes =
    (profile.prefixes && profile.prefixes.length > 0) ||
    (profile.suffixes && profile.suffixes.length > 0) ||
    (profile.infixes && profile.infixes.length > 0) ||
    (profile.wordRoots && profile.wordRoots.length > 0);

  return Boolean(hasAffixes);
}

/**
 * Generate a compound name (root-root structure)
 * Useful for location names and titles
 */
export function generateCompound(
  rng: () => number,
  root1: string,
  root2: string,
  separator: string = ""
): string {
  return root1 + separator + root2;
}

/**
 * Apply honorific prefix
 */
export function applyHonorific(
  rng: () => number,
  name: string,
  profile: MorphologyProfile
): string {
  if (!profile.honorifics || profile.honorifics.length === 0) {
    return name;
  }

  const honorific = pickRandom(rng, profile.honorifics);
  return `${honorific} ${name}`;
}
