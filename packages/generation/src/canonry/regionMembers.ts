/** Region membership is iterable numerical state, independent of its backing storage. */
export interface RegionMembers extends Iterable<number> {
  readonly [index: number]: number;
  readonly length: number;
  reduce(callback: (previous: number, value: number) => number): number;
  reduce(callback: (previous: number, value: number) => number, initial: number): number;
  forEach(callback: (value: number, index: number) => void): void;
  includes(value: number): boolean;
}
