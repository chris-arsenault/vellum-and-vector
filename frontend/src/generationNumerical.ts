import type { DomainSnapshot, GridSurface } from "@atlas/domain";

interface SampleReference {
  $atlasSamples: number;
}
type Description =
  | null
  | undefined
  | string
  | number
  | boolean
  | SampleReference
  | Description[]
  | { [key: string]: Description };
export interface NumericalMessage {
  kind: "numerical";
  grids: Record<string, Description>;
}
export interface SamplesMessage {
  kind: "samples";
  samples: { id: number; value: ArrayBufferView<ArrayBuffer> }[];
}

/** Describe all views before transferring: detachment also clears other views' offsets. */
export function numericalMessages(numerical: DomainSnapshot["numerical"]) {
  const objects = new WeakMap<object, Description>();
  const buffers = new Map<ArrayBuffer, SamplesMessage["samples"]>();
  let sequence = 0;
  function describe(value: unknown): Description {
    if (value === null || typeof value !== "object") return value as Description;
    const previous = objects.get(value);
    if (previous) return previous;
    if (ArrayBuffer.isView(value)) {
      const view = value as ArrayBufferView<ArrayBuffer>,
        reference = { $atlasSamples: sequence++ };
      objects.set(value, reference);
      const samples = buffers.get(view.buffer) ?? [];
      samples.push({ id: reference.$atlasSamples, value: view });
      buffers.set(view.buffer, samples);
      return reference;
    }
    const description: Description[] | Record<string, Description> = Array.isArray(value) ? [] : {};
    objects.set(value, description);
    for (const [key, child] of Object.entries(value))
      (description as Record<string, Description>)[key] = describe(child);
    return description;
  }
  const grids = Object.fromEntries(
    Object.entries(numerical).map(([id, grid]) => [id, describe(grid)])
  );
  return { description: { kind: "numerical", grids } as NumericalMessage, buffers };
}

function sampleReference(value: Description): value is SampleReference {
  return !!value && typeof value === "object" && "$atlasSamples" in value;
}
function dependencies(value: Description, result = new Set<number>(), seen = new Set<object>()) {
  if (!value || typeof value !== "object" || seen.has(value)) return result;
  seen.add(value);
  if (sampleReference(value)) result.add(value.$atlasSamples);
  else Object.values(value).forEach((child) => dependencies(child, result, seen));
  return result;
}

export class NumericalReceiver {
  private pending = new Map<string, { description: Description; requires: Set<number> }>();
  private samples = new Map<number, ArrayBufferView<ArrayBuffer>>();
  private objects = new WeakMap<object, object>();

  describe(message: NumericalMessage) {
    for (const [id, description] of Object.entries(message.grids))
      this.pending.set(id, { description, requires: dependencies(description) });
    return this.ready();
  }
  receive(message: SamplesMessage) {
    for (const sample of message.samples) this.samples.set(sample.id, sample.value);
    return this.ready();
  }
  private restore(description: Description): unknown {
    if (!description || typeof description !== "object") return description;
    if (sampleReference(description)) return this.samples.get(description.$atlasSamples)!;
    const previous = this.objects.get(description);
    if (previous) return previous;
    const value: unknown[] | Record<string, unknown> = Array.isArray(description) ? [] : {};
    this.objects.set(description, value);
    for (const [key, child] of Object.entries(description))
      (value as Record<string, unknown>)[key] = this.restore(child);
    return value;
  }
  private ready() {
    const grids: Record<string, GridSurface> = {};
    for (const [id, entry] of this.pending) {
      if (![...entry.requires].every((sample) => this.samples.has(sample))) continue;
      grids[id] = this.restore(entry.description) as GridSurface;
      this.pending.delete(id);
    }
    return grids;
  }
  get complete() {
    return this.pending.size === 0;
  }
}

/** Native structured cloning preserves the views' types, lengths and shared buffers. */
export function transferableBuffers(
  value: unknown,
  buffers = new Set<ArrayBuffer>(),
  seen = new Set<object>()
) {
  if (!value || typeof value !== "object" || seen.has(value)) return [...buffers];
  seen.add(value);
  if (value instanceof ArrayBuffer) buffers.add(value);
  else if (ArrayBuffer.isView(value)) buffers.add(value.buffer as ArrayBuffer);
  else Object.values(value).forEach((child) => transferableBuffers(child, buffers, seen));
  return [...buffers];
}
