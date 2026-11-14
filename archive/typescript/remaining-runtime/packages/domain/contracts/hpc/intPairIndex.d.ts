/** Dense identities for int32 pairs, with typed open addressing and constant-time clearing. */
export declare class IntPairIndex {
  private a;
  private b;
  private slots;
  private stamps;
  length: number;
  first(index: number): number;
  second(index: number): number;
  clear(): void;
  private slot;
  include(a: number, b: number): number;
  private grow;
}
