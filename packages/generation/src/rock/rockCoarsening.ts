import { blendLayers, type MaterialLayer } from "./rockLayerFields";
import type { Column } from "@atlas/domain";
import type { ColumnWatcher } from "./rockColumn";
import { sameCargo } from "./materialCargo";

export function sameMaterial(a: MaterialLayer, b: MaterialLayer) {
  return (
    a.kind === b.kind &&
    a.secondaryKind === b.secondaryKind &&
    a.secondaryShare === b.secondaryShare &&
    a.strength === b.strength &&
    a.damage === b.damage &&
    a.grainX === b.grainX &&
    a.grainY === b.grainY &&
    sameBed(a, b) &&
    sameAlteration(a, b)
  );
}
const sameAlteration = (a: MaterialLayer, b: MaterialLayer) =>
  a.altered === b.altered && a.mixed === b.mixed && sameCargo(a.cargo, b.cargo);
const sameBed = (a: MaterialLayer, b: MaterialLayer) =>
  a.bedSlopeX === b.bedSlopeX &&
  a.bedSlopeY === b.bedSlopeY &&
  a.deposited === b.deposited &&
  a.consolidation === b.consolidation;

export function coarsenAt(
  layers: MaterialLayer[],
  cell: number,
  column: Column,
  upper: number,
  watchers: Iterable<ColumnWatcher>
) {
  const a = layers[upper],
    combined = blendLayers(a, layers[upper + 1]);
  let above = 0;
  for (let layer = 0; layer < upper; layer++) above += layers[layer].depth;
  for (const watcher of watchers) {
    watcher.fold(cell, a.kind, combined.kind, a.depth, above);
    watcher.merge?.(cell, column, upper, { ...combined });
  }
  layers.splice(upper, 2, combined);
}

/** Linked temporary slots keep unchanged contact priorities through successive folds. */
class Contacts {
  readonly next: Int32Array;
  readonly above: Float64Array;
  rank = 1;
  private previous = 0;
  private readonly equivalent: Uint8Array;
  private readonly thickness: Float64Array;
  constructor(
    private readonly layers: MaterialLayer[],
    private readonly basement: boolean
  ) {
    const size = layers.length;
    this.next = new Int32Array(size);
    this.above = new Float64Array(size);
    this.equivalent = new Uint8Array(size);
    this.thickness = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      this.next[i] = i + 1 < size ? i + 1 : -1;
      if (i > 0) this.above[i] = this.above[i - 1] + layers[i - 1].depth;
      this.update(i);
    }
  }
  private update(upper: number) {
    const lower = this.next[upper];
    if (upper === 0 || lower < 0 || (this.basement && lower === this.layers.length - 1)) return;
    const a = this.layers[upper],
      b = this.layers[lower];
    this.equivalent[upper] = Number(sameMaterial(a, b));
    this.thickness[upper] = a.depth + b.depth;
  }
  best() {
    let best = this.next[0],
      previous = best,
      rank = 2;
    this.previous = 0;
    this.rank = 1;
    for (let at = this.next[best]; this.next[at] >= 0; at = this.next[at]) {
      if (this.basement && this.next[at] === this.layers.length - 1) break;
      if (
        this.equivalent[at] > this.equivalent[best] ||
        (this.equivalent[at] === this.equivalent[best] &&
          this.thickness[at] <= this.thickness[best])
      ) {
        best = at;
        this.previous = previous;
        this.rank = rank;
      }
      previous = at;
      rank++;
    }
    return best;
  }
  merge(upper: number, result: MaterialLayer) {
    this.layers[upper] = result;
    this.next[upper] = this.next[this.next[upper]];
    this.update(upper);
    this.update(this.previous);
  }
  compact() {
    let count = 0;
    for (let at = 0; at >= 0; at = this.next[at]) this.layers[count++] = this.layers[at];
    this.layers.length = count;
  }
}

export function coarsenBulk(
  layers: MaterialLayer[],
  cell: number,
  column: Column,
  size: number,
  basement: boolean,
  watchers: Iterable<ColumnWatcher>
) {
  if (layers.length <= size) return;
  const contacts = new Contacts(layers, basement);
  try {
    for (let count = layers.length; count > size; count--) {
      const upper = contacts.best(),
        a = layers[upper],
        result = blendLayers(a, layers[contacts.next[upper]]);
      for (const watcher of watchers) {
        watcher.fold(cell, a.kind, result.kind, a.depth, contacts.above[upper]);
        watcher.merge?.(cell, column, contacts.rank, { ...result });
      }
      contacts.merge(upper, result);
    }
  } finally {
    contacts.compact();
  }
}
