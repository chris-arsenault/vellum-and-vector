import { createRNG, pickWeighted } from "./utils/rng.js";
import { capitalize } from "./utils/helpers.js";

/** Same start-padding, end marker and probability table format as both Canonry runtimes. */
export interface MarkovModel {
  order: number;
  startStates: Record<string, number>;
  transitions: Record<string, Record<string, number>>;
}
export interface MarkovOptions {
  minLength?: number;
  maxLength?: number;
}

function normalize(counts: Record<string, number>) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, count / total]));
}

function addSample(transitions: MarkovModel["transitions"], padded: string, order: number) {
  for (let i = 0; i < padded.length - order; i++) {
    const state = padded.slice(i, i + order),
      next = padded[i + order];
    const row = (transitions[state] ??= Object.create(null));
    row[next] = (row[next] ?? 0) + 1;
  }
}

/** Port of scripts/markov-trainer.cjs, without filesystem IO or probability rounding. */
export function trainMarkovChain(names: readonly string[], order = 3): MarkovModel {
  if (!Number.isSafeInteger(order) || order < 1) throw new Error("Markov order must be positive.");
  const transitions: MarkovModel["transitions"] = Object.create(null);
  const startStates: Record<string, number> = Object.create(null);
  for (const name of names) {
    const normalized = name.trim().toLowerCase();
    if (normalized.length < 2) continue;
    if (/[\^$]/.test(normalized)) throw new Error("Markov names cannot contain boundary markers.");
    const padded = "^".repeat(order) + normalized + "$";
    const start = padded.slice(0, order);
    startStates[start] = (startStates[start] ?? 0) + 1;
    addSample(transitions, padded, order);
  }
  if (!Object.keys(startStates).length) throw new Error("Markov training needs name samples.");
  return {
    order,
    startStates: normalize(startStates),
    transitions: Object.fromEntries(
      Object.entries(transitions).map(([s, row]) => [s, normalize(row)])
    ),
  };
}

function weighted(row: Record<string, number>, rng: () => number) {
  return pickWeighted(rng, Object.keys(row), Object.values(row));
}
function sample(model: MarkovModel, rng: () => number, maxLength: number): string | null {
  let state = weighted(model.startStates, rng),
    word = "";
  for (let i = 0; i <= maxLength; i++) {
    const row = model.transitions[state];
    if (!row || !Object.keys(row).length) return null;
    const next = weighted(row, rng);
    if (next === "$") return word;
    word += next;
    state = (state + next).slice(-model.order);
  }
  return null;
}

/** Reject unfinished words rather than turning maxLength into an arbitrary word ending. */
function checkLengths(minLength: number, maxLength: number) {
  if (
    !Number.isSafeInteger(minLength) ||
    !Number.isSafeInteger(maxLength) ||
    minLength < 1 ||
    maxLength < minLength
  )
    throw new Error("Invalid Markov length range.");
}

export function generateMarkov(
  model: MarkovModel,
  rng: () => number,
  { minLength = 4, maxLength = 16 }: MarkovOptions = {}
): string {
  checkLengths(minLength, maxLength);
  for (let attempt = 0; attempt < 128; attempt++) {
    const word = sample(model, rng, maxLength);
    if (word && word.length >= minLength) return capitalize(word);
  }
  throw new Error("Markov model could not produce a complete name in the requested length range.");
}
export function generateFromMarkov(model: MarkovModel, options: MarkovOptions & { seed: string }) {
  return generateMarkov(model, createRNG(options.seed), options);
}
