import { requireThat } from "../errors";
import type { BlockScratch } from "./blockScratch";

/** What the cache needs from a band to evict one of its blocks. */
export interface BlockOwner {
  /** Drop the block from memory, spilling it first when it is dirty. */
  evict(block: number): void;
}
interface Entry {
  owner: BlockOwner;
  block: number;
  bytes: number;
  pins: number;
  used: boolean;
}
/**
 * One cache per worker holds loaded band-blocks under a byte budget. Pinned blocks (the ones
 * a block loop is reading) are never evicted; others leave in second-chance order. A budget
 * of `Infinity` keeps everything resident, and the cache is then only an inventory.
 */
export class BlockCache {
  private readonly entries = new Map<BlockOwner, Map<number, Entry>>();
  private readonly ring: Entry[] = [];
  private head = 0;
  private held = 0;
  readonly stats = { loads: 0, evictions: 0, peakBytes: 0 };
  constructor(
    readonly budgetBytes: number,
    readonly scratch: BlockScratch | null = null
  ) {
    requireThat(budgetBytes > 0, "block_budget", "A block cache needs a positive byte budget.");
  }
  get bytes() {
    return this.held;
  }
  /** Account for a block that was just loaded, evicting others to make room. */
  admit(owner: BlockOwner, block: number, bytes: number) {
    this.stats.loads++;
    while (this.held + bytes > this.budgetBytes && this.evictOne()) {
      // evicting until the block fits or nothing can go
    }
    let blocks = this.entries.get(owner);
    if (!blocks) this.entries.set(owner, (blocks = new Map()));
    const entry: Entry = { owner, block, bytes, pins: 0, used: false };
    blocks.set(block, entry);
    this.ring.push(entry);
    this.held += bytes;
    this.stats.peakBytes = Math.max(this.stats.peakBytes, this.held);
  }
  pin(owner: BlockOwner, block: number) {
    const entry = this.entries.get(owner)?.get(block);
    requireThat(entry, "block_pin", "Pin a loaded block.");
    entry.pins++;
    entry.used = true;
  }
  unpin(owner: BlockOwner, block: number) {
    const entry = this.entries.get(owner)?.get(block);
    if (entry && entry.pins > 0) entry.pins--;
  }
  touch(owner: BlockOwner, block: number) {
    const entry = this.entries.get(owner)?.get(block);
    if (entry) entry.used = true;
  }
  /** Forget a block the owner dropped itself (release or explicit eviction). */
  forget(owner: BlockOwner, block?: number) {
    const blocks = this.entries.get(owner);
    if (!blocks) return;
    if (block === undefined) {
      for (const entry of blocks.values()) this.drop(entry);
      this.entries.delete(owner);
      return;
    }
    const entry = blocks.get(block);
    if (entry) this.drop(entry);
    if (!blocks.size) this.entries.delete(owner);
  }
  private drop(entry: Entry) {
    const blocks = this.entries.get(entry.owner);
    if (blocks?.get(entry.block) !== entry) return;
    blocks.delete(entry.block);
    this.held -= entry.bytes;
    entry.bytes = 0;
  }
  private evictOne() {
    const total = this.ring.length;
    for (let scanned = 0; scanned < total * 2 && this.ring.length; scanned++) {
      if (this.head >= this.ring.length) {
        this.compact();
        if (!this.ring.length) return false;
      }
      const entry = this.ring[this.head];
      if (entry.bytes === 0) {
        this.head++;
        continue;
      }
      if (entry.pins > 0) {
        this.head++;
        continue;
      }
      if (entry.used) {
        entry.used = false;
        this.ring.push(entry);
        this.head++;
        continue;
      }
      this.head++;
      this.stats.evictions++;
      entry.owner.evict(entry.block);
      this.drop(entry);
      return true;
    }
    return false;
  }
  private compact() {
    const live = this.ring.filter((entry) => entry.bytes > 0),
      seen = new Set<Entry>();
    this.ring.length = 0;
    for (const entry of live)
      if (!seen.has(entry)) {
        seen.add(entry);
        this.ring.push(entry);
      }
    this.head = 0;
  }
}
