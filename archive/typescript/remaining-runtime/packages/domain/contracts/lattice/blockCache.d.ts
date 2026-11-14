import type { BlockScratch } from "./blockScratch";
/** What the cache needs from a band to evict one of its blocks. */
export interface BlockOwner {
  /** Drop the block from memory, spilling it first when it is dirty. */
  evict(block: number): void;
}
/**
 * One cache per worker holds loaded band-blocks under a byte budget. Pinned blocks (the ones
 * a block loop is reading) are never evicted; others leave in second-chance order. A budget
 * of `Infinity` keeps everything resident, and the cache is then only an inventory.
 */
export declare class BlockCache {
  readonly budgetBytes: number;
  readonly scratch: BlockScratch | null;
  private readonly entries;
  private readonly clock;
  private cursor;
  private held;
  readonly stats: {
    loads: number;
    evictions: number;
    peakBytes: number;
  };
  constructor(budgetBytes: number, scratch?: BlockScratch | null);
  get bytes(): number;
  get trackedBlocks(): number;
  get trackedOwners(): number;
  /** Account for a block that was just loaded, evicting others to make room. */
  admit(owner: BlockOwner, block: number, bytes: number): void;
  pin(owner: BlockOwner, block: number): void;
  unpin(owner: BlockOwner, block: number): void;
  touch(owner: BlockOwner, block: number): void;
  /** Forget a block the owner dropped itself (release or explicit eviction). */
  forget(owner: BlockOwner, block?: number): void;
  private drop;
  private evictOne;
  private nextEntry;
}
