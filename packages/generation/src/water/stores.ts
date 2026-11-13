import type { Band } from "@atlas/domain";

/** One store at an explicit point: contents, room, and its response to a request. */
export class WaterStore {
  constructor(
    public held: number,
    readonly capacity: number,
    readonly retention = 0
  ) {}
  get room() {
    return Math.max(0, this.capacity - this.held);
  }
  receive(amount: number) {
    const supplied = Math.max(0, amount),
      kept = Math.min(supplied, this.room);
    this.held += kept;
    return supplied - kept;
  }
  /** Freely draining stores give up to their contents; soil gives exponentially less as it dries. */
  give(request: number) {
    const demand = Math.max(0, request),
      amount =
        this.retention > 0
          ? this.held * -Math.expm1(-demand / this.retention)
          : Math.min(this.held, demand);
    this.held -= amount;
    return amount;
  }
}

/** A store's columnar contents remain in the map's numerical resources. */
export class StoreColumn {
  constructor(
    private readonly contents: Band,
    readonly capacity: (cell: number) => number,
    private readonly retained = false,
    private readonly metresPerUnit = 1
  ) {}
  held(cell: number) {
    return this.contents.get(cell) * this.metresPerUnit;
  }
  room(cell: number) {
    return Math.max(0, this.capacity(cell) - this.held(cell));
  }
  replace(cell: number, depth: number) {
    this.contents.set(cell, Math.max(0, depth) / this.metresPerUnit);
  }
  at(cell: number) {
    const capacity = this.capacity(cell);
    return new WaterStore(this.held(cell), capacity, this.retained ? capacity : 0);
  }
  receive(cell: number, depth: number) {
    const store = this.at(cell),
      overflow = store.receive(depth);
    this.replace(cell, store.held);
    return overflow;
  }
  give(cell: number, depth: number) {
    const store = this.at(cell),
      released = store.give(depth);
    this.replace(cell, store.held);
    return released;
  }
}

export interface WaterColumn {
  snow: StoreColumn;
  soil: StoreColumn;
  ground: StoreColumn;
  standing: StoreColumn;
}

/** The receiver returns overflow; a transfer never invents supply or silently drops it. */
export function transferColumn(from: StoreColumn, to: StoreColumn, cell: number, request: number) {
  const given = from.give(cell, request),
    overflow = to.receive(cell, given);
  return { given, received: given - overflow, overflow };
}
