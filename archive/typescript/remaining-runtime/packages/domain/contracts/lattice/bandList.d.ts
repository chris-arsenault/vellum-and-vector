import type { SampleType } from "../workspaceResources";
import type { Band } from "./band";
import type { Coverage } from "./coverage";
/**
 * An append-only list of samples whose length is unknown until it is built, stored as one
 * block-sized scratch band per chunk so it pages like any band. `finish` hands back one band
 * of the exact length, block for chunk.
 */
export declare class BandList {
  private readonly coverage;
  private readonly type;
  private readonly name;
  private chunks;
  length: number;
  constructor(coverage: Coverage, type: SampleType, name: string);
  push(value: number): void;
  /** The first chunk doubles up to a block, so a short list holds a short band. */
  private grow;
  get(i: number): number;
  /** The samples as one scratch band of the exact length; the list is emptied. */
  finish(): Band;
  release(): void;
}
