/** One bit per index in 32-bit words. */
export class BitSet {
  readonly words: Uint32Array;
  constructor(readonly length: number) {
    this.words = new Uint32Array((length + 31) >>> 5);
  }
  has(i: number) {
    return (this.words[i >>> 5] & (1 << (i & 31))) !== 0;
  }
  set(i: number) {
    this.words[i >>> 5] |= 1 << (i & 31);
  }
  clear(i: number) {
    this.words[i >>> 5] &= ~(1 << (i & 31));
  }
  /** Sets the bit; returns whether it was clear before. */
  add(i: number) {
    const word = i >>> 5,
      mask = 1 << (i & 31),
      fresh = (this.words[word] & mask) === 0;
    this.words[word] |= mask;
    return fresh;
  }
  clearAll() {
    this.words.fill(0);
  }
  count() {
    let total = 0;
    for (let w = 0; w < this.words.length; w++) total += popcount(this.words[w]);
    return total;
  }
  /** The first set index at or after `from`, or -1. */
  nextSet(from: number): number {
    if (from >= this.length) return -1;
    let word = from >>> 5,
      bits = this.words[word] & (0xffffffff << (from & 31));
    for (;;) {
      if (bits !== 0) return (word << 5) + (31 - Math.clz32(bits & -bits));
      if (++word >= this.words.length) return -1;
      bits = this.words[word];
    }
  }
  forEach(visit: (i: number) => void) {
    for (let i = this.nextSet(0); i >= 0; i = this.nextSet(i + 1)) visit(i);
  }
}
export function popcount(word: number) {
  word -= (word >>> 1) & 0x55555555;
  word = (word & 0x33333333) + ((word >>> 2) & 0x33333333);
  return (Math.imul((word + (word >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
}
