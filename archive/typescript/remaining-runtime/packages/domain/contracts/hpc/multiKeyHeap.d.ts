/** Binary heap on int items ordered by up to four float keys, each ascending or descending,
 * then by ascending item. For frontiers whose order is composite or not monotone. */
export declare class MultiKeyHeap {
  private items;
  private keys;
  private count;
  private readonly signs;
  private readonly width;
  private popped;
  constructor(directions: ("asc" | "desc")[], capacity?: number);
  get size(): number;
  /** Key j of the item most recently popped. */
  key(j: number): number;
  private before;
  private swap;
  push(item: number, k0: number, k1?: number, k2?: number, k3?: number): void;
  pop(): number;
  private siftDown;
}
