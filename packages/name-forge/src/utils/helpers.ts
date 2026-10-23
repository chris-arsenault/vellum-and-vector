/**
 * String manipulation helpers
 */

// ============================================================================
// Capitalization
// ============================================================================

/**
 * Capitalization styles:
 * - "title": First letter uppercase, rest lowercase (e.g., "Testname")
 * - "titleWords": Each word capitalized (e.g., "King Of The North")
 * - "allcaps": All uppercase (e.g., "TESTNAME")
 * - "lowercase": All lowercase (e.g., "testname")
 * - "mixed": Alternating case (e.g., "TeSt NaMe")
 */
export type Capitalization = "title" | "titleWords" | "allcaps" | "lowercase" | "mixed";

/**
 * Capitalize first letter of a string
 */
export function capitalize(str: string): string {
  if (str.length === 0) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Capitalize first letter of each word
 */
export function capitalizeWords(str: string): string {
  return str
    .split(/(\s+)/) // Split but keep whitespace
    .map((part) => {
      // Don't capitalize whitespace-only parts
      if (/^\s+$/.test(part)) return part;
      return capitalize(part.toLowerCase());
    })
    .join("");
}

/**
 * Alternating capitalization (e.g., "test name" → "TeSt NaMe")
 */
export function mixedCase(str: string): string {
  let letterIndex = 0;
  return str
    .split("")
    .map((char) => {
      if (/[a-zA-Z]/.test(char)) {
        const result = letterIndex % 2 === 0 ? char.toUpperCase() : char.toLowerCase();
        letterIndex++;
        return result;
      }
      return char;
    })
    .join("");
}

/**
 * Apply capitalization style to a string
 */
export function applyCapitalization(str: string, style: Capitalization): string {
  switch (style) {
    case "title":
      return capitalize(str.toLowerCase());
    case "titleWords":
      return capitalizeWords(str);
    case "allcaps":
      return str.toUpperCase();
    case "lowercase":
      return str.toLowerCase();
    case "mixed":
      return mixedCase(str);
    default:
      return str;
  }
}

/**
 * Check if a string ends with any of the given suffixes
 */
export function endsWithAny(str: string, suffixes: string[]): boolean {
  return suffixes.some((suffix) => str.toLowerCase().endsWith(suffix.toLowerCase()));
}

/**
 * Find legal positions to insert apostrophes or hyphens
 * Returns indices between syllables (not in the middle of syllable templates)
 */
export function findSyllableBoundaries(word: string, syllables: string[]): number[] {
  const boundaries: number[] = [];
  let position = 0;

  for (let i = 0; i < syllables.length - 1; i++) {
    position += syllables[i].length;
    boundaries.push(position);
  }

  return boundaries;
}

/**
 * Insert a character at a random syllable boundary
 */
export function insertAtBoundary(
  word: string,
  char: string,
  boundaries: number[],
  rng: () => number
): string {
  if (boundaries.length === 0) return word;

  const index = boundaries[Math.floor(rng() * boundaries.length)];
  return word.slice(0, index) + char + word.slice(index);
}

/**
 * Validate that a name doesn't contain forbidden clusters
 */
export function hasForbiddenCluster(name: string, forbiddenClusters: string[]): boolean {
  const lower = name.toLowerCase();
  return forbiddenClusters.some((cluster) => lower.includes(cluster.toLowerCase()));
}

/**
 * Check if a name contains any favored clusters
 */
export function hasFavoredCluster(name: string, favoredClusters: string[]): boolean {
  const lower = name.toLowerCase();
  return favoredClusters.some((cluster) => lower.includes(cluster.toLowerCase()));
}

/**
 * Count syllables in a word (rough approximation based on vowel groups)
 */
export function estimateSyllableCount(word: string): number {
  // Simple heuristic: count vowel groups
  const vowelGroups = word.toLowerCase().match(/[aeiou]+/g);
  return vowelGroups ? vowelGroups.length : 1;
}

/**
 * Calculate vowel ratio (vowels / total length)
 */
export function calculateVowelRatio(word: string): number {
  if (word.length === 0) return 0;
  const vowelCount = (word.toLowerCase().match(/[aeiou]/g) || []).length;
  return vowelCount / word.length;
}

/**
 * Normalize weights array (make them sum to 1)
 */
export function normalizeWeights(weights: number[]): number[] {
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (total === 0) {
    // All zero, return uniform
    return weights.map(() => 1 / weights.length);
  }
  return weights.map((w) => Math.max(0, w) / total);
}

/**
 * Deep clone an object using JSON serialization
 * Note: Loses functions, undefined, symbols, etc.
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}
