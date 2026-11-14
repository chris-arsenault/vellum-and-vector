import type { StyleRules } from "./types/domain.js";
import { chance } from "./utils/rng.js";
import {
  applyCapitalization,
  findSyllableBoundaries,
  insertAtBoundary,
  endsWithAny,
} from "./utils/helpers.js";

/** Insert both apostrophe and hyphen markers at different boundaries. */
function insertBothMarkers(
  text: string,
  boundaries: number[],
  rng: () => number,
  transforms: string[]
): string {
  if (boundaries.length >= 2) {
    const shuffled = [...boundaries].sort(() => rng() - 0.5);
    const apoIdx = shuffled[0];
    const hypIdx = shuffled[1];

    // Insert at higher index first to preserve positions
    let result = text;
    if (apoIdx > hypIdx) {
      result = result.slice(0, apoIdx) + "'" + result.slice(apoIdx);
      result = result.slice(0, hypIdx) + "-" + result.slice(hypIdx);
    } else {
      result = result.slice(0, hypIdx) + "-" + result.slice(hypIdx);
      result = result.slice(0, apoIdx) + "'" + result.slice(apoIdx);
    }
    transforms.push("apostrophe", "hyphen");
    return result;
  }

  // Only one boundary: randomly pick one marker
  if (rng() < 0.5) {
    transforms.push("apostrophe");
    return insertAtBoundary(text, "'", boundaries, rng);
  }
  transforms.push("hyphen");
  return insertAtBoundary(text, "-", boundaries, rng);
}

/** Insert stylistic markers (apostrophe/hyphen) at syllable boundaries. */
function insertStyleMarkers(
  text: string,
  boundaries: number[],
  wantApostrophe: boolean,
  wantHyphen: boolean,
  rng: () => number,
  transforms: string[]
): string {
  if (wantApostrophe && wantHyphen) {
    return insertBothMarkers(text, boundaries, rng, transforms);
  }
  if (wantApostrophe) {
    transforms.push("apostrophe");
    return insertAtBoundary(text, "'", boundaries, rng);
  }
  transforms.push("hyphen");
  return insertAtBoundary(text, "-", boundaries, rng);
}

/**
 * Apply stylistic transforms to a name
 */
export function applyStyle(
  rng: () => number,
  name: string,
  style: StyleRules,
  syllables: string[]
): { result: string; transforms: string[] } {
  let result = name;
  const transforms: string[] = [];

  const apostropheRate = style.apostropheRate ?? 0;
  const hyphenRate = style.hyphenRate ?? 0;
  const capitalization = style.capitalization ?? "title";

  const wantApostrophe = apostropheRate > 0 && chance(rng, apostropheRate);
  const wantHyphen = hyphenRate > 0 && chance(rng, hyphenRate);

  if ((wantApostrophe || wantHyphen) && syllables.length > 1) {
    const boundaries = findSyllableBoundaries(result, syllables);
    if (boundaries.length > 0) {
      result = insertStyleMarkers(result, boundaries, wantApostrophe, wantHyphen, rng, transforms);
    }
  }

  result = applyCapitalization(result, capitalization);
  transforms.push(`cap:${capitalization}`);

  return { result, transforms };
}

/**
 * Check if a name has a preferred ending
 */
export function hasPreferredEnding(name: string, preferredEndings: string[]): boolean {
  if (preferredEndings.length === 0) {
    return false;
  }
  return endsWithAny(name, preferredEndings);
}

/**
 * Generate multiple candidates and boost those with preferred endings
 */
export function selectWithPreferredEndings<T>(
  rng: () => number,
  candidates: T[],
  nameExtractor: (candidate: T) => string,
  preferredEndings: string[],
  boost: number = 2.0
): T {
  if (preferredEndings.length === 0 || candidates.length === 0) {
    // No preference, pick uniformly
    return candidates[Math.floor(rng() * candidates.length)];
  }

  // Calculate weights
  const weights = candidates.map((candidate) => {
    const name = nameExtractor(candidate);
    return hasPreferredEnding(name, preferredEndings) ? boost : 1.0;
  });

  // Weighted selection
  const total = weights.reduce((sum, w) => sum + w, 0);
  const r = rng() * total;
  let cumulative = 0;

  for (let i = 0; i < candidates.length; i++) {
    cumulative += weights[i];
    if (r < cumulative) {
      return candidates[i];
    }
  }

  // Fallback
  return candidates[candidates.length - 1];
}

/**
 * Apply rhythm-based adjustments to a name
 * This is a placeholder for future enhancement
 */
export function applyRhythmBias(name: string): string {
  // Rhythm bias is primarily enforced during phonology generation.
  // Post-processing transformations (softening consonant clusters,
  // emphasizing consonants, adding syllable breaks, smoothing transitions)
  // can be added here in the future.
  return name;
}

/**
 * Validate that a name meets style constraints
 */
export function validateStyle(name: string): boolean {
  // Basic validation: more complex checks (apostrophe/hyphen placement,
  // capitalization, double apostrophes) can be added here.
  return name.length > 0;
}

/**
 * Apply all stylistic transforms and select best candidate
 */
export function applyStyleWithCandidates(
  rng: () => number,
  candidates: string[],
  style: StyleRules,
  syllablesPerCandidate: string[][]
): string {
  if (candidates.length === 0) {
    throw new Error("No candidates provided");
  }

  // Generate styled versions
  const styledCandidates = candidates.map((name, index) => {
    const syllables = syllablesPerCandidate[index];
    const { result } = applyStyle(rng, name, style, syllables);
    return result;
  });

  // Select with preferred endings boost
  return selectWithPreferredEndings(
    rng,
    styledCandidates,
    (name) => name,
    style.preferredEndings ?? [],
    style.preferredEndingBoost
  );
}

/**
 * Strip style markers for comparison
 * Useful for validation and deduplication
 */
export function normalizeForComparison(name: string): string {
  return name
    .toLowerCase()
    .replace(/['\-\s]/g, "") // Remove apostrophes, hyphens, spaces
    .trim();
}

/**
 * Check if two names are too similar (considering style variations)
 */
export function areTooSimilar(name1: string, name2: string): boolean {
  const norm1 = normalizeForComparison(name1);
  const norm2 = normalizeForComparison(name2);
  return norm1 === norm2;
}
