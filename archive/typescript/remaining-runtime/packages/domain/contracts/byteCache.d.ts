/** Cache capacity bounds retained bytes, not the size of the user's world. */
export declare class ByteCache<K, V> {
  readonly capacity: number;
  private dispose;
  private entries;
  private retained;
  constructor(capacity: number, dispose?: (value: V) => void);
  get(key: K): V | undefined;
  /** Borrow a value without moving it for every sample in the same active chunk. */
  peek(key: K): V | undefined;
  set(key: K, value: V, bytes: number): boolean;
  delete(key: K): void;
  clear(): void;
  deleteWhere(predicate: (key: K, value: V) => boolean): void;
  get bytes(): number;
}
