import { DomainError, readRange } from "@atlas/domain";
import { expect, it, vi } from "vitest";
import { configuration, epoch, invoke, landscape, options } from "./mapFixtures";
import { MapRunner } from "./mapRunner";
import { MapProcessRegistry, type MapProcess } from "./process";

function process(
  id: string,
  apply: Extract<MapProcess["behavior"], { kind: "model-pass" }>["applyPass"]
): MapProcess {
  return {
    contract: { id, version: "1", parameters: {}, requires: [], produces: [id], invalidates: [] },
    behavior: { kind: "model-pass", applyPass: apply },
    validate: () => [],
  };
}

it.each([
  "numerical_read",
  "numerical_write",
  "feature_read",
  "feature_write",
  "network_read",
  "network_write",
  "contour_read",
  "contour_write",
])("aborts generation on %s instead of publishing incomplete causal history", async (code) => {
  const fail = process("storage", () => {
    throw new DomainError(code, "Local disk could not complete a transfer.");
  });
  const after = vi.fn(),
    following = process("following", after);
  const runner = new MapRunner(
    configuration([invoke(fail), invoke(following)]),
    new MapProcessRegistry().register(fail).register(following)
  );
  await expect(runner.run(landscape(), options)).rejects.toMatchObject({ code });
  expect(after).not.toHaveBeenCalled();
});

it.each([false, true])(
  "records async=%s failures and continues without restoring working state",
  async (asyncFailure) => {
    const initial = landscape();
    const good = process("good", (state) => {
      state.surface.channels.elevation.set(0, 17);
    });
    const bad = process("bad", (state) => {
      state.surface.channels.elevation.set(1, 23);
      const error = new Error("Failed output");
      if (asyncFailure) return Promise.reject(error);
      throw error;
    });
    const consume = vi.fn();
    const dependent = process("dependent", consume);
    dependent.contract.requires = ["bad"];
    const independent = process("independent", (state) => {
      state.surface.channels.elevation.set(2, 31);
    });
    const registry = new MapProcessRegistry();
    for (const entry of [good, bad, dependent, independent]) registry.register(entry);
    const diagnostic = vi.fn();
    const { state } = await new MapRunner(
      configuration([good, bad, dependent, independent].map((entry) => invoke(entry))),
      registry
    ).run(initial, { ...options, diagnostic });
    expect([...readRange(state.surface.channels.elevation, 0, 3)]).toEqual([17, 23, 31]);
    expect(state.facts).toEqual(new Set(["elevation", "good", "independent"]));
    expect(state.diagnostics).toMatchObject([
      {
        code: "process_failed",
        invocation: "bad",
        outcome: "omitted",
        stack: expect.stringContaining("Failed output"),
      },
      { code: "stale_fact", invocation: "dependent", resource: "bad", outcome: "skipped" },
    ]);
    expect(diagnostic).toHaveBeenCalledTimes(2);
    expect(consume).not.toHaveBeenCalled();
    expect(initial.surface.channels.elevation.get(0)).toBe(-10);
  }
);

it("retains validator warnings and original error details without establishing failed outputs", async () => {
  const warning = {
    code: "approximate",
    severity: "warning" as const,
    message: "Approximate result",
    invocation: null,
    resource: "elevation",
  };
  const good = process("good", () => {});
  good.validate = () => [warning];
  const bad = process("bad", () => {});
  bad.validate = () => [{ ...warning, severity: "error", code: "invalid_elevation" }];
  const registry = new MapProcessRegistry().register(good).register(bad);
  const { state } = await new MapRunner(configuration([invoke(good), invoke(bad)]), registry).run(
    landscape(),
    options
  );
  expect(state.facts.has("bad")).toBe(false);
  expect(state.diagnostics).toMatchObject([
    { code: "approximate", outcome: "retained", resource: "elevation" },
    { code: "invalid_elevation", outcome: "omitted", resource: "elevation" },
  ]);
});

it("invalidates affected facts on failure and permits a later epoch to produce them", async () => {
  const run = process("response", (_state, context) => {
    if (context.epochs[0].id === "first") throw new Error("failed epoch");
  });
  run.contract.invalidates = ["prior-response"];
  const consume = vi.fn();
  const consumer = process("consumer", consume);
  consumer.contract.requires = ["response"];
  const registry = new MapProcessRegistry().register(run).register(consumer);
  const initial = landscape();
  initial.facts.add("prior-response");
  const { state } = await new MapRunner(
    configuration([
      {
        kind: "epochs",
        id: "history",
        resetFacts: ["response"],
        epochs: [epoch("first", 1), epoch("second", 1)],
        body: [invoke(run), invoke(consumer)],
      },
    ]),
    registry
  ).run(initial, options);
  expect(consume).toHaveBeenCalledOnce();
  expect(state.facts.has("response")).toBe(true);
  expect(state.facts.has("prior-response")).toBe(false);
  expect(state.diagnostics?.map((entry) => entry.epochs[0].id)).toEqual(["first", "first"]);
});

it("propagates cancellation and invalid inherited geography", async () => {
  const cancelled = process("cancelled", () => {
    throw new DomainError("generation_cancelled", "Generation was cancelled.");
  });
  const registry = new MapProcessRegistry().register(cancelled);
  await expect(
    new MapRunner(configuration([invoke(cancelled)]), registry).run(landscape(), options)
  ).rejects.toThrow("cancelled");
  const invalid = landscape();
  invalid.surface.scope = { ...invalid.surface.scope, worldId: "another-world" };
  await expect(
    new MapRunner(configuration([]), new MapProcessRegistry()).run(invalid, options)
  ).rejects.toThrow("pinned context");
});

it("allows the adapter to yield between stages and cancels before applying the next process", async () => {
  let cancelled = false;
  const applied: string[] = [];
  const first = process("first", () => {
    applied.push("first");
  });
  const second = process("second", () => {
    applied.push("second");
  });
  const registry = new MapProcessRegistry().register(first).register(second);
  await expect(
    new MapRunner(configuration([invoke(first), invoke(second)]), registry).run(landscape(), {
      ...options,
      cancelled: () => cancelled,
      async yieldControl() {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (applied.length) cancelled = true;
      },
    })
  ).rejects.toThrow("cancelled");
  expect(applied).toEqual(["first"]);
});
