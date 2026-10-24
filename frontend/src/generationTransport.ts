import {
  requireThat,
  type Diagnostic,
  type DomainSnapshot,
  type World,
  type Grid,
} from "@atlas/domain";
import type { EpochHistory } from "@atlas/generation";
import {
  numericalMessages,
  NumericalReceiver,
  type NumericalMessage,
  type SamplesMessage,
} from "./generationNumerical";

const collections = [
  "entities",
  "templates",
  "connections",
  "networkNodes",
  "networkReaches",
  "societies",
  "features",
] as const;
type Collection = (typeof collections)[number];
export type GenerationMessage =
  | { kind: "progress"; path: string[]; fraction: number; message: string }
  | { kind: "diagnostic"; diagnostic: Diagnostic }
  | { kind: "preview"; grid: Grid; label: string }
  | {
      kind: "snapshot";
      snapshot: DomainSnapshot;
      history: EpochHistory[];
      diagnostics: Diagnostic[];
    }
  | { kind: "records"; collection: Collection; entries: [string, unknown][] }
  | NumericalMessage
  | SamplesMessage
  | { kind: "completed" }
  | { kind: "failed"; error: string; diagnostics?: Diagnostic[] };
type Send = (message: GenerationMessage, transfer: ArrayBuffer[]) => void;
const yieldToEditor = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Batch existing output collections; generation processes know nothing about transport. */
export async function sendGeneration(
  snapshot: DomainSnapshot,
  history: EpochHistory[],
  diagnostics: Diagnostic[],
  send: Send
) {
  const numerical = numericalMessages(snapshot.numerical);
  const world = { ...snapshot.world };
  for (const key of collections) if (world[key] !== undefined) Object.assign(world, { [key]: {} });
  send(
    { kind: "snapshot", snapshot: { ...snapshot, world, numerical: {} }, history, diagnostics },
    []
  );
  send(numerical.description, []);
  for (const [buffer, samples] of numerical.buffers) {
    send({ kind: "samples", samples }, [buffer]);
    numerical.buffers.delete(buffer);
    await yieldToEditor();
  }
  for (const collection of collections) {
    const entries = Object.entries(snapshot.world[collection] ?? {});
    for (let index = 0; index < entries.length; index += 128) {
      send({ kind: "records", collection, entries: entries.slice(index, index + 128) }, []);
      await yieldToEditor();
    }
  }
  send({ kind: "completed" }, []);
}

export class GenerationReceiver {
  snapshot: DomainSnapshot;
  readonly history: EpochHistory[];
  readonly diagnostics: Diagnostic[];
  private numerical = new NumericalReceiver();
  constructor(message: Extract<GenerationMessage, { kind: "snapshot" }>) {
    this.snapshot = message.snapshot;
    this.history = message.history;
    this.diagnostics = message.diagnostics;
  }
  receive(
    message: NumericalMessage | SamplesMessage | Extract<GenerationMessage, { kind: "records" }>
  ) {
    if (message.kind === "records") {
      const world = this.snapshot.world;
      this.snapshot = {
        ...this.snapshot,
        world: {
          ...world,
          [message.collection]: {
            ...world[message.collection],
            ...Object.fromEntries(message.entries),
          },
        },
      };
      if (message.collection === "features")
        this.snapshot.world.featureCount = Object.keys(this.snapshot.world.features).length;
      return;
    }
    const grids =
      message.kind === "numerical"
        ? this.numerical.describe(message)
        : this.numerical.receive(message);
    this.snapshot = { ...this.snapshot, numerical: { ...this.snapshot.numerical, ...grids } };
  }
  visibleWorld(version: number): World {
    const world = this.snapshot.world;
    return {
      ...world,
      version,
      fields: world.fields.filter((field) => this.snapshot.numerical[field.id]),
    };
  }
  complete() {
    requireThat(
      this.numerical.complete,
      "generation_delivery",
      "Generation ended before all numerical resources arrived."
    );
    return this.snapshot;
  }
}
