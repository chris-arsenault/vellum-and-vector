import { expect, it, vi } from "vitest";
import {
  bindOperation,
  commandBatch,
  defineCommand,
  defineQuery,
  processRevision,
  readOperation,
  runOperation,
  selectOperation,
} from "./processOperation";

it("executes nested commands through one revision and refreshes their consumers", () => {
  const owner = {},
    input = { value: 2 },
    observed: number[] = [];
  const read = defineQuery(
    "read",
    (input: { value: number }) => {
      observed.push(input.value);
    },
    []
  );
  const change = defineCommand(
    "change",
    "event",
    (input: { value: number }) => {
      input.value++;
    },
    []
  );
  const parent = defineCommand(
    "parent",
    "event",
    (input: { value: number }) => {
      readOperation(owner, read, input);
      runOperation(owner, change, input);
      readOperation(owner, read, input);
    },
    []
  );
  bindOperation(owner, read);
  runOperation(owner, parent, input);
  expect(observed).toEqual([2, 3]);
});

it("shares dependency freshness and replaces algorithms without bypassing constituents", () => {
  const a = {},
    b = {},
    input = {},
    ordinary = vi.fn(),
    specialized = vi.fn();
  const source = defineQuery("source", ordinary, []);
  const consumer = defineQuery("consumer", () => undefined, [source]);
  bindOperation(a, source, specialized);
  bindOperation(b, source);
  bindOperation(a, consumer);
  bindOperation(b, consumer);
  readOperation(a, consumer, input);
  readOperation(b, consumer, input);
  readOperation(a, source, input);
  expect(specialized).toHaveBeenCalledOnce();
  expect(ordinary).toHaveBeenCalledOnce();
  runOperation(
    a,
    defineCommand("change", "event", () => undefined, []),
    input
  );
  readOperation(a, consumer, input);
  readOperation(b, consumer, input);
  expect(specialized).toHaveBeenCalledTimes(2);
  expect(ordinary).toHaveBeenCalledOnce();
});

it("does not activate omitted producers when a selected consumer requests them", () => {
  const owner = {},
    read = vi.fn(),
    input = {};
  const omitted = defineQuery("omitted", read, []);
  const consumer = defineQuery("consumer", () => undefined, [omitted]);
  bindOperation(owner, consumer);
  readOperation(owner, consumer, input);
  expect(read).not.toHaveBeenCalled();
});

it("initialization selects intrinsic reads before first publication without enabling omitted features", () => {
  const owner = {},
    input = {},
    calls: string[] = [];
  const omitted = defineQuery(
    "optional",
    () => {
      calls.push("optional");
    },
    []
  );
  const current = defineQuery(
    "current",
    () => {
      calls.push("current");
    },
    [omitted]
  );
  const classify = defineQuery(
    "classify",
    () => {
      calls.push("classify");
    },
    [current]
  );
  const initialize = defineCommand(
    "initialize",
    "initialize",
    () => {
      selectOperation(owner, current);
      selectOperation(owner, classify);
    },
    []
  );
  const publish = defineCommand(
    "publish",
    "publish",
    () => {
      calls.push("publish");
    },
    [classify]
  );
  runOperation(owner, initialize, input);
  runOperation(owner, publish, input);
  expect(calls).toEqual(["current", "classify", "publish"]);
});

it("rejects commands hidden in query bodies and restores the read scope after failure", () => {
  const owner = {},
    input = {},
    changed = vi.fn();
  const command = defineCommand("mutation", "event", changed, []);
  const invalid = defineQuery("hidden-command", () => runOperation(owner, command, input), []);
  bindOperation(owner, invalid);
  expect(() => readOperation(owner, invalid, input)).toThrow("query cannot dispatch");
  expect(changed).not.toHaveBeenCalled();
  runOperation(owner, command, input);
  expect(changed).toHaveBeenCalledOnce();
  const batch = defineQuery("hidden-stage", () => commandBatch(owner, () => undefined), []);
  bindOperation(owner, batch);
  expect(() => readOperation(owner, batch, input)).toThrow("query cannot dispatch");
});

it("keeps simultaneous inputs current until the material stage settles", () => {
  const owner = {},
    input = { value: 0 },
    seen: number[] = [];
  const read = defineQuery(
    "read",
    (input: { value: number }) => {
      seen.push(input.value);
    },
    []
  );
  const change = defineCommand(
    "change",
    "work",
    (input: { value: number }) => {
      input.value++;
    },
    []
  );
  bindOperation(owner, read);
  readOperation(owner, read, input);
  commandBatch(owner, () => {
    runOperation(owner, change, input);
    readOperation(owner, read, input);
  });
  readOperation(owner, read, input);
  expect(seen).toEqual([0, 1]);
});

it("invalidates before asynchronous completion is published and also after failure", async () => {
  const owner = {},
    revision = processRevision(owner);
  await runOperation(
    owner,
    defineCommand(
      "async",
      "publish",
      async () => {
        await Promise.resolve();
      },
      []
    ),
    {}
  );
  expect(processRevision(owner)).toBeGreaterThan(revision);
  const settled = processRevision(owner);
  await expect(
    runOperation(
      owner,
      defineCommand(
        "failure",
        "event",
        async () => {
          throw new Error("failure");
        },
        []
      ),
      {}
    )
  ).rejects.toThrow("failure");
  expect(processRevision(owner)).toBeGreaterThan(settled);
});

it("detects cycles without caching failure and preserves a selected strategy", () => {
  const owner = {},
    input = {},
    read = vi.fn();
  const cyclic = defineQuery("cycle", () => readOperation(owner, cyclic, input), []);
  bindOperation(owner, cyclic);
  expect(() => readOperation(owner, cyclic, input)).toThrow("Cyclic derived query");
  bindOperation(owner, cyclic, read);
  selectOperation(owner, cyclic);
  readOperation(owner, cyclic, input);
  expect(read).toHaveBeenCalledOnce();
});
