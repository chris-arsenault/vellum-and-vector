import type { GenerationState } from "./process";

/**
 * What a run remembers beside its fields: named tables a process keeps from one epoch to the
 * next, such as the totals places have applied or the variety each place was chosen to be.
 * Each table is plain data (maps, sets, typed arrays), so a run continued from a saved epoch
 * can be given the same memory. A table that is only a cache of the current fields does not
 * belong here.
 */
const memories = new WeakMap<GenerationState, Map<string, unknown>>();

/** The run's table of this name, made the first time it is asked for. */
export function runMemory<T>(state: GenerationState, name: string, create: () => T): T {
  let tables = memories.get(state);
  if (!tables) memories.set(state, (tables = new Map()));
  if (!tables.has(name)) tables.set(name, create());
  return tables.get(name) as T;
}
/** Every table the run holds, for saving. The tables are live: copy before the run goes on. */
export function runMemories(state: GenerationState): ReadonlyMap<string, unknown> {
  return memories.get(state) ?? new Map();
}
/** Give a run the memory a saved one held. */
export function restoreRunMemories(state: GenerationState, saved: ReadonlyMap<string, unknown>) {
  memories.set(state, new Map(saved));
}
