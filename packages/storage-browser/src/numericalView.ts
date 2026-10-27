import { requireThat, type NumericalVector, type SampleArray } from "@atlas/domain";
import { vectorRange, type VectorStorage } from "./vectorStorage";
import { sortVector, numericalSortRunSamples } from "./vectorSort";

const views = new WeakMap<object, NumericalView>();
function indexed(property: PropertyKey) {
  if (typeof property !== "string") return null;
  if (property === "-0") return NaN;
  const index = Number(property);
  return String(index) === property ? index : null;
}
function copyBackward(target: NumericalView, values: ArrayLike<number>, offset: number) {
  const source = views.get(values);
  return (
    !!source &&
    source.storage === target.storage &&
    target.offset + offset > source.offset &&
    target.offset + offset < source.offset + values.length
  );
}
/** Scalar access is available for graph operations; local passes use storage.readBlock(). */
export class NumericalView implements NumericalVector {
  [index: number]: number;
  readonly view: NumericalVector;
  constructor(
    readonly storage: VectorStorage,
    readonly offset = 0,
    readonly length = storage.length - offset
  ) {
    requireThat(
      Number.isSafeInteger(offset) &&
        Number.isSafeInteger(length) &&
        offset >= 0 &&
        length >= 0 &&
        offset + length <= storage.length,
      "numerical_view",
      "Numerical views stay inside their allocation."
    );
    this.view = new Proxy(this, {
      get: (target, key) => {
        const index = indexed(key);
        if (index !== null)
          return Number.isInteger(index) && index >= 0 && index < length
            ? storage.read(offset + index)
            : undefined;
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
      set: (target, key, value) => {
        const index = indexed(key);
        if (index === null) return Reflect.set(target, key, value, target);
        if (Number.isInteger(index) && index >= 0 && index < length)
          storage.write(offset + index, Number(value));
        return true;
      },
      has: (target, key) => {
        const index = indexed(key);
        return index === null
          ? Reflect.has(target, key)
          : Number.isInteger(index) && index >= 0 && index < length;
      },
    });
    views.set(this.view, this);
  }
  private read(index: number) {
    return this.storage.read(this.offset + index);
  }
  get sampleType() {
    return this.storage.type;
  }
  get immutable() {
    return this.storage.immutable ?? false;
  }
  retain() {
    this.storage.retain();
  }
  readBlock(start: number, count: number) {
    requireThat(
      start >= 0 && count >= 0 && start + count <= this.length,
      "numerical_range",
      "Read stays inside its numerical view."
    );
    return this.storage.readBlock(this.offset + start, count);
  }
  writeBlock(start: number, values: SampleArray) {
    requireThat(
      start >= 0 && start + values.length <= this.length,
      "numerical_range",
      "Write stays inside its numerical view."
    );
    this.storage.writeBlock(this.offset + start, values);
  }
  private write(index: number, value: number) {
    this.storage.write(this.offset + index, value);
  }
  private create(length: number, name: string) {
    return new NumericalView(
      this.storage.allocate({ type: this.storage.type, length, lifetime: "process", name })
    );
  }
  at(index: number) {
    index = Math.trunc(index) || 0;
    if (index < 0) index += this.length;
    return index >= 0 && index < this.length ? this.read(index) : undefined;
  }
  set(values: ArrayLike<number>, offset = 0) {
    offset = Math.trunc(offset) || 0;
    if (offset < 0 || offset + values.length > this.length)
      throw new RangeError("Numerical assignment exceeds its view.");
    const backward = copyBackward(this, values, offset);
    for (let at = 0; at < values.length; at++) {
      const i = backward ? values.length - 1 - at : at;
      this.write(offset + i, values[i]);
    }
  }
  fill(value: number, start = 0, end = this.length) {
    const range = vectorRange(this.length, start, end);
    this.storage.fill(this.offset + range.start, range.length, value);
    return this.view as this;
  }
  slice(start = 0, end = this.length) {
    const range = vectorRange(this.length, start, end),
      result = this.create(range.length, "slice");
    for (let at = 0; at < range.length; at += numericalSortRunSamples)
      result.storage.writeBlock(
        at,
        this.storage.readBlock(
          this.offset + range.start + at,
          Math.min(numericalSortRunSamples, range.length - at)
        )
      );
    return result.view;
  }
  subarray(start = 0, end = this.length) {
    const range = vectorRange(this.length, start, end);
    return new NumericalView(this.storage, this.offset + range.start, range.length).view;
  }
  copyWithin(target: number, start: number, end = this.length) {
    const range = vectorRange(this.length, start, end),
      to = vectorRange(this.length, target).start;
    this.set(
      this.subarray(range.start, range.start + Math.min(range.length, this.length - to)),
      to
    );
    return this.view as this;
  }
  reverse() {
    for (let i = 0; i < Math.floor(this.length / 2); i++) {
      const j = this.length - 1 - i,
        value = this.read(i);
      this.write(i, this.read(j));
      this.write(j, value);
    }
    return this.view as this;
  }
  sort(compare?: (a: number, b: number) => number) {
    sortVector(this.storage, this.offset, this.length, compare);
    return this.view as this;
  }
  forEach(callback: (value: number, index: number, array: NumericalVector) => void) {
    for (let i = 0; i < this.length; i++) callback(this.read(i), i, this.view);
  }
  map(callback: (value: number, index: number, array: NumericalVector) => number) {
    const result = this.create(this.length, "map");
    for (let i = 0; i < this.length; i++) result.write(i, callback(this.read(i), i, this.view));
    return result.view;
  }
  filter(callback: (value: number, index: number, array: NumericalVector) => unknown) {
    const result = this.create(this.length, "filter");
    let count = 0;
    for (let i = 0; i < this.length; i++) {
      const value = this.read(i);
      if (callback(value, i, this.view)) result.write(count++, value);
    }
    return result.subarray(0, count);
  }
  findIndex(callback: (value: number, index: number, array: NumericalVector) => unknown) {
    for (let i = 0; i < this.length; i++) if (callback(this.read(i), i, this.view)) return i;
    return -1;
  }
  find(callback: (value: number, index: number, array: NumericalVector) => unknown) {
    const i = this.findIndex(callback);
    return i < 0 ? undefined : this.read(i);
  }
  every(callback: (value: number, index: number, array: NumericalVector) => unknown) {
    return this.findIndex((v, i, a) => !callback(v, i, a)) < 0;
  }
  some(callback: (value: number, index: number, array: NumericalVector) => unknown) {
    return this.findIndex(callback) >= 0;
  }
  indexOf(value: number, fromIndex = 0) {
    for (let i = vectorRange(this.length, fromIndex).start; i < this.length; i++)
      if (this.read(i) === value) return i;
    return -1;
  }
  includes(value: number, fromIndex = 0) {
    for (let i = vectorRange(this.length, fromIndex).start; i < this.length; i++) {
      const current = this.read(i);
      if (current === value || (Number.isNaN(value) && Number.isNaN(current))) return true;
    }
    return false;
  }
  reduce(
    callback: (previous: number, value: number, index: number, array: NumericalVector) => number
  ): number;
  reduce<T>(
    callback: (previous: T, value: number, index: number, array: NumericalVector) => T,
    initial: T
  ): T;
  reduce<T>(
    callback: (previous: T, value: number, index: number, array: NumericalVector) => T,
    ...initial: T[]
  ): T {
    if (!this.length && !initial.length)
      throw new TypeError("Reduce of an empty numerical vector.");
    let i = initial.length ? 0 : 1,
      value = initial.length ? initial[0] : (this.read(0) as T);
    for (; i < this.length; i++) value = callback(value, this.read(i), i, this.view);
    return value;
  }
  join(separator = ",") {
    let value = "";
    for (let i = 0; i < this.length; i++) value += (i ? separator : "") + String(this.read(i));
    return value;
  }
  *entries(): IterableIterator<[number, number]> {
    for (let i = 0; i < this.length; i++) yield [i, this.read(i)];
  }
  *keys(): IterableIterator<number> {
    for (let i = 0; i < this.length; i++) yield i;
  }
  *values(): IterableIterator<number> {
    for (let i = 0; i < this.length; i++) yield this.read(i);
  }
  [Symbol.iterator]() {
    return this.values();
  }
}
export function numericalViewStorage(vector: NumericalVector) {
  const view = views.get(vector);
  requireThat(view, "numerical_view", "Expected a numerical working view.");
  return view;
}
export function numericalStorage(vector: NumericalVector) {
  return views.get(vector)?.storage;
}
