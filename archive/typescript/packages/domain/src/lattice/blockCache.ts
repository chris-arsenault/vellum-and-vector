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
  private readonly clock = new Set<Entry>();
  private cursor: SetIterator<Entry> | null = null;
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
  get trackedBlocks() {
    return this.clock.size;
  }
  get trackedOwners() {
    return this.entries.size;
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
    this.clock.add(entry);
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
      return;
    }
    const entry = blocks.get(block);
    if (entry) this.drop(entry);
  }
  private drop(entry: Entry) {
    const blocks = this.entries.get(entry.owner);
    if (blocks?.get(entry.block) !== entry) return;
    blocks.delete(entry.block);
    if (!blocks.size) this.entries.delete(entry.owner);
    this.clock.delete(entry);
    if (!this.clock.size) this.cursor = null;
    this.held -= entry.bytes;
  }
  private evictOne() {
    // Two turns give every unpinned block its second chance; an all-pinned
    // inventory cannot make room, so the caller admits the required working block.
    const visits = this.clock.size * 2;
    for (let scanned = 0; scanned < visits && this.clock.size; scanned++) {
      const entry = this.nextEntry();
      if (entry.bytes === 0 || entry.pins > 0) continue;
      if (entry.used) {
        entry.used = false;
        continue;
      }
      this.stats.evictions++;
      entry.owner.evict(entry.block);
      this.drop(entry);
      return true;
    }
    return false;
  }
  private nextEntry() {
    this.cursor ??= this.clock.values();
    let next = this.cursor.next();
    if (next.done) {
      this.cursor = this.clock.values();
      next = this.cursor.next();
    }
    return next.value!;
  }
}
