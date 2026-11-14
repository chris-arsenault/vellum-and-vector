import { expect, it } from "vitest";
import { landscape, epoch, configuration, invoke, options } from "./mapFixtures";
import type { MapProcessContext, MapProcess } from "./process";
import {
  executeMapOperation,
  mapCommand,
  mapElapsed,
  mapQuery,
  mapWork,
  elapsedYears,
  type MapOperation,
} from "./processTraits";
import { MapRunner } from "./mapRunner";
import { MapProcessRegistry } from "./process";

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
function definition(operation: MapOperation): MapProcess {
  return {
    contract: {
      id: operation.id,
      version: "1",
      parameters: {},
      requires: [],
      produces: [],
      invalidates: [],
    },
    operation,
    validate: () => [],
  };
}
it("binds explicit elapsed duration and rejects absent or invalid time", () => {
  expect(elapsedYears({ kind: "epoch", fraction: 0.5 }, context())).toBe(2500);
  expect(() => elapsedYears({ kind: "epoch", fraction: 1 }, { epochs: [] })).toThrow("duration");
  expect(() => elapsedYears({ kind: "years", years: -1 }, context())).toThrow("duration");
});
it("keeps current queries cached until explicit work while passing actual exposure", () => {
  const seen: number[] = [],
    state = landscape(),
    ctx = context();
  const current = mapQuery(
    "current",
    () => {
      seen.push(-1);
    },
    []
  );
  const work = mapWork(
    "work",
    () => 0.25,
    (_state, _context, exposure) => {
      seen.push(exposure);
    },
    [current]
  );
  executeMapOperation(current, state, ctx);
  executeMapOperation(current, state, ctx);
  executeMapOperation(work, state, ctx);
  executeMapOperation(current, state, ctx);
  expect(seen).toEqual([-1, 0.25, -1]);
  const invalid = mapWork(
    "invalid",
    () => -1,
    () => undefined,
    []
  );
  expect(() => executeMapOperation(invalid, state, ctx)).toThrow("exposure");
});
it("passes the bound years to the elapsed owner", () => {
  let years = 0;
  const operation = mapElapsed(
    "age",
    { kind: "epoch", fraction: 0.5 },
    (_state, _context, elapsed) => {
      years = elapsed;
    },
    []
  );
  executeMapOperation(operation, landscape(), context());
  expect(years).toBe(2500);
});
it("awaits command completion before validation and product publication", async () => {
  const calls: string[] = [];
  const process = definition(
    mapCommand(
      "publication",
      "publish",
      async () => {
        calls.push("started");
        await Promise.resolve();
        calls.push("completed");
      },
      []
    )
  );
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
it("rejects a failed command before validation or delivery", async () => {
  let validated = false,
    delivered = false;
  const process = definition(
    mapCommand(
      "failure",
      "event",
      async () => {
        throw new Error("Material transformation failed");
      },
      []
    )
  );
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
