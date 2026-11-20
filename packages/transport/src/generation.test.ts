import { Encoder } from "cbor-x";
import { expect, it } from "vitest";
import { RpcGeneration, type GenerationCall } from "./generation";

const status = { jobId: "job", state: "completed", step: "Map published" };

it("reads a retained preview by epoch and a worker's preview from its event", async () => {
  const retained = new Encoder({ useRecords: false }).encode({ grid: { values: [1, NaN] } });
  const calls: GenerationCall[] = [];
  const generation = new RpcGeneration(async (call: GenerationCall) => {
    calls.push(call);
    if (call.method === "preview") {
      if ((call.request as { epoch: number }).epoch === 2)
        throw new Error("This preview is no longer kept");
      return retained;
    }
    return {
      events: [
        {
          kind: "preview",
          jobId: "job",
          epoch: 1,
          mediaType: "application/vnd.atlas.preview+cbor",
        },
        {
          kind: "preview",
          jobId: "job",
          epoch: 2,
          mediaType: "application/vnd.atlas.preview+cbor",
        },
        {
          kind: "preview",
          jobId: "job",
          epoch: 3,
          map: {
            mediaType: "application/vnd.atlas.preview+json",
            bytes: new TextEncoder().encode('{"grid":{"values":[3]}}'),
          },
        },
      ],
      next: 3,
      status,
    };
  });
  const events = [];
  for await (const event of generation.observe("job")) events.push(event);
  // The retained preview's missing value reads as null; the one no longer kept is skipped.
  expect(events).toEqual([
    { kind: "preview", jobId: "job", epoch: 1, preview: { grid: { values: [1, null] } } },
    { kind: "preview", jobId: "job", epoch: 3, preview: { grid: { values: [3] } } },
  ]);
  expect(calls.filter((call) => call.method === "preview")).toHaveLength(2);
});
