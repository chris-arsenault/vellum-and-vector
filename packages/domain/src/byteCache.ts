/** Cache capacity bounds retained bytes, not the size of the user's world. */
export class ByteCache<K, V> {
  private entries = new Map<K, { value: V; bytes: number }>();
  private retained = 0;
  constructor(
    readonly capacity: number,
    private dispose: (value: V) => void = () => {}
  ) {}
  get(key: K) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  /** Borrow a value without moving it for every sample in the same active chunk. */
  peek(key: K) {
    return this.entries.get(key)?.value;
  }
  set(key: K, value: V, bytes: number) {
    this.delete(key);
    if (bytes > this.capacity) return false;
    while (this.retained + bytes > this.capacity && this.entries.size)
      this.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, bytes });
    this.retained += bytes;
    return true;
  }
  delete(key: K) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.dispose(entry.value);
    this.entries.delete(key);
    this.retained -= entry.bytes;
  }
  clear() {
    for (const key of this.entries.keys()) this.delete(key);
  }
  deleteWhere(predicate: (key: K, value: V) => boolean) {
    for (const [key, entry] of this.entries) if (predicate(key, entry.value)) this.delete(key);
  }
  get bytes() {
    return this.retained;
  }
}
