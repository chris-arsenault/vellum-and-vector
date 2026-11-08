import { expect, it } from "vitest";
import { landscape, epoch } from "./mapFixtures";
import type { MapProcessContext, MapProcess } from "./process";
import { executeProcessBehavior, type ProcessBehavior } from "./processTraits";
import { MapRunner } from "./mapRunner";
import { MapProcessRegistry } from "./process";
import { configuration, invoke, options } from "./mapFixtures";

function context(): MapProcessContext {
  return {
    scope: landscape().domain.scope,
    invocation: ["test"],
    parameters: {},
    epochs: [epoch("age", 5000)],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
  };
}
function definition(behavior: ProcessBehavior): MapProcess {
  return {
    contract: {
      id: "trait",
      version: "1",
      parameters: {},
      requires: [],
      produces: [],
      invalidates: [],
    },
    behavior,
    validate: () => [],
  };
}
it("dispatches real initialize, pass, transfer and extraction operations without deduplicating passes", async () => {
  const calls: string[] = [];
  const operations: ProcessBehavior[] = [
    {
      kind: "initialize",
      initialize: () => {
        calls.push("initialize");
      },
    },
    {
      kind: "model-pass",
      applyPass: () => {
        calls.push("pass");
      },
    },
    {
      kind: "transfer",
      transfer: () => {
        calls.push("transfer");
      },
    },
    {
      kind: "extract",
      extract: () => {
        calls.push("extract");
      },
    },
  ];
  const state = landscape(),
    ctx = context();
  for (const behavior of operations) await executeProcessBehavior(definition(behavior), state, ctx);
  await executeProcessBehavior(definition(operations[1]), state, ctx);
  expect(calls).toEqual(["initialize", "pass", "transfer", "extract", "pass"]);
});
it("binds elapsed evolution to the explicit epoch fraction and rejects an absent clock", () => {
  let advanced = 0;
  const process = definition({
    kind: "elapsed",
    duration: { kind: "epoch", fraction: 0.5 },
    advance: (_state, _context, years) => {
      advanced += years;
    },
  });
  const ctx = context();
  executeProcessBehavior(process, landscape(), ctx);
  expect(advanced).toBe(2500);
  expect(() => executeProcessBehavior(process, landscape(), { ...ctx, epochs: [] })).toThrow(
    "duration"
  );
});

it("executes forcing contributions and awaits material transformation completion", async () => {
  const calls: string[] = [];
  const state = landscape(),
    ctx = context();
  await executeProcessBehavior(
    definition({
      kind: "forcing-contributor",
      contribute() {
        calls.push("forcing");
      },
    }),
    state,
    ctx
  );
  await executeProcessBehavior(
    definition({
      kind: "material-transformation",
      async transform() {
        await Promise.resolve();
        calls.push("material");
      },
    }),
    state,
    ctx
  );
  expect(calls).toEqual(["forcing", "material"]);
});

it("awaits asynchronous material transformation before validating or exposing products", async () => {
  const calls: string[] = [];
  const process = definition({
    kind: "material-transformation",
    async transform() {
      calls.push("started");
      await Promise.resolve();
      calls.push("completed");
    },
  });
  process.contract.produces = ["transformed"];
  process.validate = (state) => {
    expect(state.facts.has("transformed")).toBe(false);
    calls.push("validate");
    return [];
  };
  const result = await new MapRunner(
    configuration([invoke(process)]),
    new MapProcessRegistry().register(process)
  ).run(landscape(), options);
  expect(calls).toEqual(["started", "completed", "validate"]);
  expect(result.state.facts.has("transformed")).toBe(true);
});

it("rejects failed asynchronous transformation before validation or delivery", async () => {
  let validated = false;
  let delivered = false;
  const process = definition({
    kind: "material-transformation",
    async transform() {
      await Promise.resolve();
      throw new Error("Material transformation failed");
    },
  });
  process.validate = () => {
    validated = true;
    return [];
  };
  await expect(
    new MapRunner(configuration([invoke(process)]), new MapProcessRegistry().register(process)).run(
      landscape(),
      {
        ...options,
        async saveBoundary() {
          delivered = true;
        },
      }
    )
  ).rejects.toThrow("Material transformation failed");
  expect(validated).toBe(false);
  expect(delivered).toBe(false);
});
