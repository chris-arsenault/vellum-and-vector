import { expect, it } from "vitest";
import { landscape, epoch } from "./mapFixtures";
import type { MapProcessContext, MapProcess } from "./process";
import { executeProcessBehavior, type ProcessBehavior } from "./processTraits";

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
    apply() {
      throw new Error("Do not execute the legacy adapter when behavior exists.");
    },
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

it("executes forcing contributions and checks material balance after the transformation completes", async () => {
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
      balance() {
        calls.push("balance");
      },
    }),
    state,
    ctx
  );
  expect(calls).toEqual(["forcing", "material", "balance"]);
});
