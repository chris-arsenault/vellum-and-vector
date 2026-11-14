import type { PhonologyProfile } from "./types/domain.js";
import { pickWeighted, randomInt } from "./utils/rng.js";
import { hasForbiddenCluster, hasFavoredCluster } from "./utils/helpers.js";

/**
 * Syllable generation result
 */
export interface SyllableResult {
  syllable: string;
  template: string;
}

/**
 * Generate a single syllable from a phonology profile
 */
export function generateSyllable(rng: () => number, profile: PhonologyProfile): SyllableResult {
  // Pick a syllable template
  const template = pickWeighted(rng, profile.syllableTemplates, profile.templateWeights ?? []);

  // Build syllable by replacing C and V with phonemes
  let syllable = "";
  for (const symbol of template) {
    if (symbol === "C") {
      // Pick a consonant
      const consonant = pickWeighted(rng, profile.consonants, profile.consonantWeights ?? []);
      syllable += consonant;
    } else if (symbol === "V") {
      // Pick a vowel
      const vowel = pickWeighted(rng, profile.vowels, profile.vowelWeights ?? []);
      syllable += vowel;
    } else {
      // Literal character (for templates like "CVC-")
      syllable += symbol;
    }
  }

  return { syllable, template };
}

/**
 * Check if adding a syllable would create a forbidden cluster
 */
function wouldCreateForbiddenCluster(
  currentWord: string,
  newSyllable: string,
  forbiddenClusters: string[] = []
): boolean {
  if (forbiddenClusters.length === 0) return false;

  const testWord = currentWord + newSyllable;
  return hasForbiddenCluster(testWord, forbiddenClusters);
}

/**
 * Generate a multi-syllable word from a phonology profile
 */
export function generateWord(
  rng: () => number,
  profile: PhonologyProfile,
  maxAttempts: number = 50
): string {
  // Pick syllable count from length range
  const [minLength, maxLength] = profile.lengthRange;
  const syllableCount = randomInt(rng, minLength, maxLength);

  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts++;

    let word = "";
    let valid = true;

    // Generate syllables one by one
    for (let i = 0; i < syllableCount; i++) {
      const { syllable } = generateSyllable(rng, profile);

      // Check if this syllable would create a forbidden cluster
      if (wouldCreateForbiddenCluster(word, syllable, profile.forbiddenClusters)) {
        valid = false;
        break;
      }

      word += syllable;
    }

    if (valid) {
      // Final check: does the complete word violate forbidden clusters?
      if (profile.forbiddenClusters && hasForbiddenCluster(word, profile.forbiddenClusters)) {
        continue;
      }

      return word;
    }
  }

  // If we failed to generate a valid word, fall back to a simple single syllable
  const { syllable } = generateSyllable(rng, profile);
  return syllable;
}

/**
 * Generate multiple word candidates and pick the best one based on favored clusters
 */
export function generateWordWithFavoredClusters(
  rng: () => number,
  profile: PhonologyProfile,
  candidateCount: number = 5
): string {
  // If no favored clusters, just generate one word
  if (!profile.favoredClusters || profile.favoredClusters.length === 0) {
    return generateWord(rng, profile);
  }

  // Generate multiple candidates
  const candidates: string[] = [];
  for (let i = 0; i < candidateCount; i++) {
    candidates.push(generateWord(rng, profile));
  }

  // Calculate scores based on favored clusters
  const boost = profile.favoredClusterBoost ?? 2.0;
  const scores = candidates.map((word) => {
    const hasFavored = hasFavoredCluster(word, profile.favoredClusters!);
    return hasFavored ? boost : 1.0;
  });

  // Pick a candidate weighted by scores
  return pickWeighted(rng, candidates, scores);
}

/**
 * Generate a batch of words for sampling/validation
 */
export function generateWords(
  rng: () => number,
  profile: PhonologyProfile,
  count: number
): string[] {
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    words.push(generateWordWithFavoredClusters(rng, profile));
  }
  return words;
}

/**
 * Get debug info about syllable generation
 */
export function generateWordWithDebug(
  rng: () => number,
  profile: PhonologyProfile
): { word: string; syllables: string[]; templates: string[] } {
  const [minLength, maxLength] = profile.lengthRange;
  const syllableCount = randomInt(rng, minLength, maxLength);

  const syllables: string[] = [];
  const templates: string[] = [];
  let word = "";

  let attempts = 0;
  const maxAttempts = 50;

  while (attempts < maxAttempts) {
    attempts++;
    syllables.length = 0;
    templates.length = 0;
    word = "";
    let valid = true;

    for (let i = 0; i < syllableCount; i++) {
      const result = generateSyllable(rng, profile);

      if (wouldCreateForbiddenCluster(word, result.syllable, profile.forbiddenClusters)) {
        valid = false;
        break;
      }

      syllables.push(result.syllable);
      templates.push(result.template);
      word += result.syllable;
    }

    if (valid) {
      if (!profile.forbiddenClusters || !hasForbiddenCluster(word, profile.forbiddenClusters)) {
        return { word, syllables, templates };
      }
    }
  }

  // Fallback
  const result = generateSyllable(rng, profile);
  return {
    word: result.syllable,
    syllables: [result.syllable],
    templates: [result.template],
  };
}
