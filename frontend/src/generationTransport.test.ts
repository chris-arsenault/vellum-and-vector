import { expect, it } from "vitest";
import { createAdaptiveField, createAdaptiveTopology, putChannel } from "@atlas/domain";
import { atlasPublicationDefinitions, generationSnapshot } from "@atlas/generation";
import { createWorldSnapshot } from "./atlasState";
import { GenerationReceiver, sendGeneration, type GenerationMessage } from "./generationTransport";
import { NumericalReceiver, numericalMessages, transferableBuffers } from "./generationNumerical";

function output() {
  const domain = createWorldSnapshot({
    name: "Streamed geography",
    seed: 7,
    width: 1000,
    height: 1000,
  });
  const grid = createAdaptiveField(
    "surface",
    domain.scope,
    createAdaptiveTopology([0, 0, 1000, 1000], { maximumSize: 250, minimumSize: 250 })
  );
  for (const [name, unit] of [
    ["elevation", "metre"],
    ["temperature", "celsius"],
    ["water", "category"],
  ])
    putChannel(
      grid,
      name,
      unit,
      Float64Array.from(grid.active, (_, i) => i)
    );
  const input = { areaId: domain.scope.areaId, seed: 7, quality: "fine", domains: ["physical"] };
  return generationSnapshot(
    {
      kind: "final",
      configurationHash: "stream",
      ancestry: [],
      state: {
        domain,
        surface: grid,
        facts: new Set(),
        history: [],
        publications: atlasPublicationDefinitions(input, domain.world),
      },
    },
    input,
    crypto.randomUUID()
  );
}

it("moves each buffer once, shares topology and exposes fields before completion", async () => {
  const snapshot = output(),
    expected = structuredClone(snapshot);
  const messages: GenerationMessage[] = [],
    transferred = new Set<ArrayBuffer>();
  const fieldCounts: number[] = [];
  let receiver: GenerationReceiver | undefined;
  await sendGeneration(snapshot, [], [], (message, transfer) => {
    for (const buffer of transfer) {
      expect(transferred.has(buffer)).toBe(false);
      transferred.add(buffer);
    }
    const received = structuredClone(message, { transfer });
    messages.push(received);
    if (received.kind === "snapshot") receiver = new GenerationReceiver(received);
    else if (["numerical", "samples", "records"].includes(received.kind)) {
      receiver!.receive(
        received as Extract<GenerationMessage, { kind: "numerical" | "samples" | "records" }>
      );
      fieldCounts.push(receiver!.visibleWorld(1).fields.length);
    }
  });
  expect(receiver!.complete()).toEqual(expected);
  expect(messages.at(-1)).toEqual({ kind: "completed" });
  expect(fieldCounts).toContain(1);
  const grids = Object.values(receiver!.snapshot.numerical);
  expect(grids[0].topology).toBe(grids[1].topology);
  expect(grids[0].active).toBe(grids[1].active);
  expect([...transferred].every((buffer) => buffer.byteLength === 0)).toBe(true);
});

it("preserves distinct views and offsets into one shared buffer, including overlays", () => {
  const snapshot = output();
  const [id, grid] = Object.entries(snapshot.numerical)[0];
  const values = Float64Array.from({ length: grid.active.length * 2 }, (_, i) => i);
  grid.channels = {
    elevation: values.subarray(0, grid.active.length),
    other: values.subarray(grid.active.length),
  };
  grid.overlays = [{ grid: { ...grid, overlays: undefined }, channels: ["other"] }];
  const expected = structuredClone(grid);
  const encoded = numericalMessages({ [id]: grid });
  const receiver = new NumericalReceiver();
  const result = receiver.describe(structuredClone(encoded.description));
  for (const [buffer, samples] of encoded.buffers)
    Object.assign(
      result,
      receiver.receive(structuredClone({ kind: "samples", samples }, { transfer: [buffer] }))
    );
  expect(result[id]).toEqual(expected);
  expect(result[id].channels.elevation.buffer).toBe(result[id].channels.other.buffer);
  expect(result[id].channels.other.byteOffset).toBe(expected.channels.other.byteOffset);
  expect(result[id].overlays![0].grid.channels.other).toBe(result[id].channels.other);
});

it("does not accept completion with missing numerical resources", () => {
  const snapshot = output();
  const receiver = new GenerationReceiver({
    kind: "snapshot",
    snapshot: { ...snapshot, numerical: {} },
    history: [],
    diagnostics: [],
  });
  receiver.receive(numericalMessages(snapshot.numerical).description);
  expect(() => receiver.complete()).toThrow("before all numerical resources arrived");
});

it("collects unique transfer buffers without knowing channel names or array types", () => {
  const values = new Float64Array(8);
  expect(
    transferableBuffers({
      elevation: values,
      nested: [new Uint8Array(values.buffer), { future: new Int32Array(3) }],
    })
  ).toHaveLength(2);
});
