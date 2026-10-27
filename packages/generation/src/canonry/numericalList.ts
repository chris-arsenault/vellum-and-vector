import {
  allocateNumerical,
  readNumericalBlock,
  writeNumericalBlock,
  requireThat,
  type NumericalAllocator,
  type NumericalVector,
  type SampleType,
} from "@atlas/domain";

const listChunkSamples = 16_384;
/** Append unknown-size graph columns once, then publish one contiguous numerical vector. */
export class NumericalList {
  private chunks: NumericalVector[] = [];
  private closed = false;
  length = 0;
  constructor(
    private type: SampleType,
    private name: string,
    private numerical?: NumericalAllocator
  ) {}
  push(value: number) {
    requireThat(!this.closed, "numerical_closed", "This graph column is complete.");
    if (this.length % listChunkSamples === 0)
      this.chunks.push(
        allocateNumerical(
          { type: this.type, length: listChunkSamples, lifetime: "process", name: this.name },
          this.numerical
        )
      );
    this.chunks.at(-1)![this.length++ % listChunkSamples] = value;
  }
  at(index: number) {
    requireThat(
      !this.closed && index >= 0 && index < this.length,
      "numerical_range",
      "Read an appended graph entry."
    );
    return this.chunks[Math.floor(index / listChunkSamples)][index % listChunkSamples];
  }
  finish() {
    const output = allocateNumerical(
      { type: this.type, length: this.length, lifetime: "process", name: this.name },
      this.numerical
    );
    try {
      for (let i = 0; i < this.chunks.length; i++) {
        const start = i * listChunkSamples,
          size = Math.min(listChunkSamples, this.length - start);
        writeNumericalBlock(output, start, readNumericalBlock(this.chunks[i], 0, size));
      }
      return output;
    } catch (error) {
      this.numerical?.releaseUnused([output], []);
      throw error;
    } finally {
      this.close();
    }
  }
  close() {
    if (this.closed) return;
    this.numerical?.releaseUnused(this.chunks, []);
    this.chunks = [];
    this.closed = true;
  }
}
