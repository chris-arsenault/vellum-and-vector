import { expect, it, vi } from "vitest";
import { MapRunner } from "./mapRunner";
import { preflight } from "./preflight";
import { ProductLedger } from "./productLedger";
import { configuration, invoke, landscape, options } from "./mapFixtures";
import { MapProcessRegistry, type MapProcess, type ProcessConfiguration } from "./process";

function process(id: string): MapProcess {
  return {
    contract: {
      id,
      version: "1",
      parameters: {},
      requires: [],
      produces: [],
      invalidates: [],
      workspaceOnly: true,
    },
    behavior: { kind: "model-pass", applyPass() {} },
    validate: () => [],
  };
}
function fixture() {
  const child = process("routing");
  child.contract.requires = ["terrain"];
  child.contract.produces = ["routing"];
  const parent = process("remesh");
  parent.contract.reconciliation = {
    invalidates: ["routing"],
    sequence: [invoke(child)],
    guarantees: ["routing"],
  };
  parent.behavior = {
    kind: "transfer",
    async transfer(_state, context) {
      await context.reconcile!();
    },
  };
  const registry = new MapProcessRegistry().register(child).register(parent);
  return { parent, child, registry };
}
function reviewed(
  config: ProcessConfiguration,
  registry: MapProcessRegistry
): ProcessConfiguration {
  return {
    ...config,
    inputs: {
      ...config.inputs,
      reconciliations: JSON.parse(JSON.stringify(registry.reconciliations())),
    },
  };
}

it("preflights actual changed-path prerequisites after immediate revocation", () => {
  const { parent, child, registry } = fixture();
  child.contract.requires.push("routing");
  const config = reviewed(configuration([invoke(parent)]), registry);
  expect(preflight(config, registry, ["terrain", "routing"])).toContainEqual(
    expect.objectContaining({
      code: "generation_prerequisite",
      resource: "routing",
      invocation: expect.stringContaining("reconciliation"),
    })
  );
});

it("requires both branch guarantees before applying the parent's ordinary produced effects", () => {
  const { parent, registry } = fixture();
  parent.contract.produces = ["routing"];
  const config = reviewed(configuration([invoke(parent)]), registry);
  expect(preflight(config, registry, ["terrain"])).toContainEqual(
    expect.objectContaining({
      code: "reconciliation_guarantee",
      resource: "routing",
      message: expect.stringContaining("unchanged"),
    })
  );
});

it("does not publish changed-path-only products into the conservative branch join", () => {
  const { parent, child, registry } = fixture();
  child.contract.produces.push("changed-only");
  const consumer = process("consumer");
  consumer.contract.requires = ["changed-only"];
  registry.register(consumer);
  const config = reviewed(configuration([invoke(parent), invoke(consumer)]), registry);
  expect(preflight(config, registry, ["terrain", "routing"])).toContainEqual(
    expect.objectContaining({ code: "generation_prerequisite", resource: "changed-only" })
  );
});

it("runs branch validation before committing parent effects and rejects false guarantees", async () => {
  const { parent, child, registry } = fixture();
  child.contract.produces = [];
  parent.contract.produces = ["finished"];
  const config = reviewed(configuration([invoke(parent)]), registry);
  const state = landscape();
  state.facts = new Set(["terrain", "routing"]);
  const commit = vi.spyOn(ProductLedger.prototype, "commit");
  try {
    await expect(new MapRunner(config, registry).run(state, options)).rejects.toThrow(
      "retain fresh routing"
    );
    expect(commit.mock.calls.some(([contract]) => contract.id === parent.contract.id)).toBe(false);
    expect(state.facts.has("routing")).toBe(true);
  } finally {
    commit.mockRestore();
  }
});

it("pins reviewed branch metadata and rejects runtime registry changes", () => {
  const { parent, registry } = fixture();
  const config = reviewed(configuration([invoke(parent)]), registry);
  expect(structuredClone(config)).toEqual(config);
  parent.contract.reconciliation!.invalidates.push("terrain");
  expect(preflight(config, registry)).toContainEqual(
    expect.objectContaining({ code: "generation_configuration" })
  );
  expect(() => new MapRunner(config, registry)).toThrow("reviewed recipe");
});

it("conservatively joins named empty inputs without reviving invalidated approximations", () => {
  const initial = new ProductLedger(new Set(["terrain"]));
  initial.initializeEmpty({
    product: "events",
    initializer: "no-events",
    retainOnInvalidation: true,
  });
  initial.initializeEmpty({ product: "forcing", initializer: "no-forcing" });
  const changed = initial.fork();
  changed.invalidate("events", "remesh");
  changed.invalidate("forcing", "remesh");
  changed.produce("new-output");
  initial.join(changed, "conditional remesh");
  expect(initial.status("terrain")).toBe("available");
  expect(initial.accepts({ product: "events", acceptEmptyFrom: "no-events" })).toBe(true);
  expect(initial.status("forcing")).toBe("stale");
  expect(initial.status("new-output")).toBe("stale");
});

it("rejects an unbound elapsed operation during preflight", () => {
  const elapsed = process("time");
  elapsed.behavior = { kind: "elapsed", duration: { kind: "epoch", fraction: 0.5 }, advance() {} };
  const registry = new MapProcessRegistry().register(elapsed);
  expect(preflight(configuration([invoke(elapsed)]), registry)).toContainEqual(
    expect.objectContaining({
      code: "generation_configuration",
      message: expect.stringContaining("duration"),
    })
  );
});
