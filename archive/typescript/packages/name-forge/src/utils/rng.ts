import seedrandom from "seedrandom";

/**
 * Create a seeded random number generator
 * Returns a function that produces random numbers in [0, 1)
 */
export function createRNG(seed: string): () => number {
  if (seed) {
    return seedrandom(seed);
  }
  // Use Math.random for unseeded
  return Math.random;
}

/**
 * Pick a random element from an array
 */
export function pickRandom<T>(rng: () => number, array: T[]): T {
  if (array.length === 0) {
    throw new Error("Cannot pick from empty array");
  }
  const index = Math.floor(rng() * array.length);
  return array[index];
}

/**
 * Pick a random element from an array with weights
 * Weights must be non-negative numbers (they'll be normalized)
 */
export function pickWeighted<T>(rng: () => number, array: T[], weights: number[]): T {
  if (array.length === 0) {
    throw new Error("Cannot pick from empty array");
  }

  // If no weights or weights length doesn't match, use uniform
  if (weights.length !== array.length) {
    return pickRandom(rng, array);
  }

  // Normalize weights
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (total === 0) {
    // All weights are zero, fall back to uniform
    return pickRandom(rng, array);
  }

  // Pick based on cumulative probabilities
  const r = rng() * total;
  let cumulative = 0;
  for (let i = 0; i < array.length; i++) {
    cumulative += Math.max(0, weights[i]);
    if (r < cumulative) {
      return array[i];
    }
  }

  // Fallback (shouldn't happen due to floating point)
  return array[array.length - 1];
}

/**
 * Pick multiple random elements from an array without replacement
 */
export function pickMultiple<T>(rng: () => number, array: T[], count: number): T[] {
  if (count <= 0) {
    return [];
  }
  if (count >= array.length) {
    return [...array];
  }

  const remaining = [...array];
  const result: T[] = [];

  for (let i = 0; i < count; i++) {
    const index = Math.floor(rng() * remaining.length);
    result.push(remaining[index]);
    remaining.splice(index, 1);
  }

  return result;
}

/**
 * Generate a random integer in range [min, max] inclusive
 */
export function randomInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/**
 * Generate a random number in range [min, max]
 */
export function randomFloat(rng: () => number, min: number, max: number): number {
  return rng() * (max - min) + min;
}

/**
 * Return true with given probability
 */
export function chance(rng: () => number, probability: number): boolean {
  return rng() < probability;
}

/**
 * Shuffle an array in place using Fisher-Yates algorithm
 */
export function shuffle<T>(rng: () => number, array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
