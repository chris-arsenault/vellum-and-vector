import {
  allocateNumerical,
  type NumericalAllocator,
  type NumericalVector,
  type SampleType,
} from "@atlas/domain";

const queueChunkSamples = 16_384;
/** FIFO for connected passes. Consumed chunks are released while later cells are discovered. */
export class NumericalQueue {
  private chunks = new Map<number, NumericalVector>();
  private head = 0;
  private tail = 0;
  constructor(
    private numerical?: NumericalAllocator,
    private type: SampleType = "int32"
  ) {}
  push(value: number) {
    const chunk = Math.floor(this.tail / queueChunkSamples);
    let values = this.chunks.get(chunk);
    if (!values) {
      values = allocateNumerical(
        {
          type: this.type,
          length: queueChunkSamples,
          lifetime: "process",
          name: "connected:queue",
        },
        this.numerical
      );
      this.chunks.set(chunk, values);
    }
    values[this.tail++ % queueChunkSamples] = value;
  }
  shift(): number | undefined {
    if (this.head === this.tail) return undefined;
    const chunk = Math.floor(this.head / queueChunkSamples),
      values = this.chunks.get(chunk)!;
    const value = values[this.head++ % queueChunkSamples];
    if (this.head % queueChunkSamples === 0) {
      this.numerical?.release(values);
      this.chunks.delete(chunk);
    }
    return value;
  }
  close() {
    for (const values of this.chunks.values()) this.numerical?.release(values);
    this.chunks.clear();
    this.head = this.tail = 0;
  }
}

/** Connected frontiers store numerical columns and decode only the current record. */
export class NumericalRecordQueue<T extends Record<string, number>> {
  private columns: NumericalQueue[];
  constructor(
    private fields: readonly (keyof T)[],
    numerical?: NumericalAllocator
  ) {
    this.columns = fields.map(() => new NumericalQueue(numerical, "float64"));
  }
  push(record: T) {
    this.columns.forEach((column, i) => column.push(record[this.fields[i]]));
  }
  shift(): T | undefined {
    const first = this.columns[0].shift();
    if (first === undefined) return undefined;
    const record = { [this.fields[0]]: first } as T;
    for (let i = 1; i < this.fields.length; i++)
      record[this.fields[i]] = this.columns[i].shift()! as T[keyof T];
    return record;
  }
  close() {
    for (const column of this.columns) column.close();
  }
}
