import { expect, it, vi } from "vitest";
import { ProductLedger, bindNativeFacts, processRequirements } from "./productLedger";
import { MapRunner } from "./mapRunner";
import { preflight } from "./preflight";
import { configuration, epoch, invoke, landscape, options } from "./mapFixtures";
import { MapProcessRegistry, type MapProcess, type GenerationState } from "./process";
import { createField } from "./canonry/field";
import { createMesh } from "./canonry/mesh";
import { atlasPhysicalProfile } from "./canonry/atlasProfile";
import { applyNativeStep, nativeContracts } from "./canonry/contracts";
import { oceanConnectivity } from "./canonry/ocean";

function process(
  id: string,
  apply: (
    state: GenerationState,
    context: import("./process").MapProcessContext
  ) => void | Promise<void> = () => {}
): MapProcess {
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
    behavior: { kind: "model-pass", applyPass: apply },
    validate: () => [],
  };
}
it("distinguishes named initialized emptiness from produced, missing and stale products", () => {
  const ledger = new ProductLedger(new Set());
  const input = {
    product: "impacts",
    acceptEmptyFrom: "empty-impacts",
  };
  expect(ledger.status("impacts")).toBe("missing");
  ledger.initializeEmpty({ product: "impacts", initializer: "empty-impacts" });
  expect(ledger.accepts(input)).toBe(true);
  expect(ledger.accepts({ product: "impacts" })).toBe(false);
  expect(ledger.accepts({ ...input, acceptEmptyFrom: "unrelated-initializer" })).toBe(false);
  expect(ledger.facts.has("impacts")).toBe(false);
  ledger.invalidate("impacts", "terrain");
  expect(ledger.status("impacts")).toBe("stale");
  ledger.produce("impacts");
  expect(ledger.status("impacts")).toBe("available");
});
it("uses the effective input's fallback without erasing its prerequisite", () => {
  const contract = process("fracture").contract;
  contract.requires = ["impacts", "terrain"];
  contract.inputs = [{ product: "impacts", acceptEmptyFrom: "empty-impacts" }];
  expect(processRequirements(contract)).toEqual([
    { product: "impacts", acceptEmptyFrom: "empty-impacts" },
    { product: "terrain" },
  ]);
});
function nativeState(): GenerationState {
  const state = landscape(),
    map = createField(createMesh(32, 0));
  map.Elevation.fill(-1024);
  map.AvailableFacts.add("Elevation");
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: new Int32Array(state.surface.active.length),
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 1000, minimumSize: 1000, featureSamples: 2 },
  };
  return state;
}
it("commits native to atlas to native transitions once and serializes observed state with ordinary Sets", async () => {
  const source = nativeContracts["ocean-connectivity"];
  const ocean = process("ocean", (state) => {
    applyNativeStep(
      state.physical!.map,
      { Profile: state.physical!.profile, EpochIndex: -1 } as never,
      ["ocean-connectivity", 0, oceanConnectivity]
    );
    expect(state.facts.has("canonry:Ocean")).toBe(false);
  });
  ocean.contract.requires = source.requires.map((fact) => `canonry:${fact}`);
  ocean.contract.produces = source.produces.map((fact) => `canonry:${fact}`);
  ocean.contract.invalidates = source.invalidates.map((fact) => `canonry:${fact}`);
  const change = process("atlas-change");
  change.contract.invalidates = ["canonry:Ocean"];
  const verify = process("verify", (state) => {
    expect(state.physical!.map.AvailableFacts.has("Ocean")).toBe(true);
    expect([...state.physical!.map.AvailableFacts]).toContain("Ocean");
  });
  verify.contract.requires = ["canonry:Ocean"];
  const registry = new MapProcessRegistry().register(ocean).register(change).register(verify);
  const spy = vi.spyOn(ProductLedger.prototype, "commit");
  try {
    const result = await new MapRunner(
      configuration([
        invoke(ocean, "first"),
        invoke(change),
        invoke(ocean, "second"),
        invoke(verify),
      ]),
      registry
    ).run(nativeState(), options);
    expect(spy).toHaveBeenCalledTimes(4);
    const cloned = structuredClone(result.state);
    expect([...cloned.physical!.map.AvailableFacts]).toContain("Ocean");
  } finally {
    spy.mockRestore();
  }
});
it("a native view observes atlas invalidation and cannot hide missing effective prerequisites", () => {
  const state = nativeState(),
    ledger = new ProductLedger(state.facts);
  bindNativeFacts(state, ledger);
  ledger.produce("canonry:Ocean");
  expect(state.physical!.map.AvailableFacts.has("Ocean")).toBe(true);
  ledger.invalidate("canonry:Ocean", "atlas heat");
  expect(state.physical!.map.AvailableFacts.has("Ocean")).toBe(false);
  expect(ledger.invalidatedBy("canonry:Ocean")).toBe("atlas heat");
});
it("the shared executor blocks a native consumer after an atlas operation invalidates its input", async () => {
  let called = false;
  const change = process("change");
  change.contract.invalidates = ["canonry:Elevation"];
  const native = process("native-consumer", () => {
    called = true;
  });
  native.contract.requires = ["canonry:Elevation"];
  const registry = new MapProcessRegistry().register(change).register(native);
  const plan = configuration([invoke(change), invoke(native)]);
  const result = await new MapRunner(plan, registry).run(nativeState(), options);
  expect(result.state.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "stale_fact",
      resource: "canonry:Elevation",
      outcome: "skipped",
    })
  );
  expect(called).toBe(false);
});
it("preflight diagnoses and runtime skips prior-epoch response while retaining carried inputs", async () => {
  const produce = process("response");
  produce.contract.produces = ["response"];
  produce.contract.products = [
    { id: "response", lifetime: "epoch" },
    { id: "material", lifetime: "run" },
  ];
  const consume = process("consume");
  consume.contract.requires = ["response", "material"];
  const registry = new MapProcessRegistry().register(produce).register(consume);
  const config = configuration([
    {
      kind: "epochs",
      id: "history",
      resetFacts: [],
      epochs: [epoch("first", 1, { active: true }), epoch("second", 1, { active: false })],
      body: [{ ...invoke(produce), when: { variable: "active", equals: true } }, invoke(consume)],
    },
  ]);
  const errors = preflight(config, registry, ["material"]);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatchObject({ resource: "response" });
  const state = landscape();
  state.facts.add("material");
  const result = await new MapRunner(config, registry).run(state, options);
  expect(result.state.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "stale_fact",
      resource: "response",
      outcome: "skipped",
    })
  );
  expect(result.state.facts.has("material")).toBe(true);
});

it("runs conditional reconciliation through the same executor, inputs and ledger with named child paths", async () => {
  const paths: string[][] = [];
  const child = process("routing", (state, context) => {
    paths.push(context.invocation);
    expect(context.inputs?.seed).toBe(73);
    expect(context.products?.facts).toBe(state.facts);
  });
  child.contract.requires = ["terrain"];
  child.contract.produces = ["routing"];
  const refinement = process("refinement", async (_state, context) => {
    if (context.inputs?.changed) await context.reconcile!();
  });
  refinement.contract.reconciliation = {
    invalidates: ["routing"],
    sequence: [invoke(child, "reconcile-water")],
    guarantees: ["routing"],
  };
  const registry = new MapProcessRegistry().register(child).register(refinement);
  for (const changed of [false, true]) {
    const state = landscape();
    state.facts.add("terrain");
    state.facts.add("routing");
    const config = {
      ...configuration([invoke(refinement, "water-refinement")]),
      inputs: {
        changed,
        seed: 73,
        reconciliations: JSON.parse(JSON.stringify(registry.reconciliations())),
      },
    };
    expect(preflight(config, registry, state.facts)).toEqual([]);
    const result = await new MapRunner(config, registry).run(state, options);
    expect(result.state.facts.has("routing")).toBe(true);
  }
  expect(paths).toEqual([["water-refinement", "reconciliation", "reconcile-water"]]);
});

function provider(id: string, composition: "exclusive" | "shared-state" = "exclusive") {
  const writer = process(id);
  writer.contract.produces = ["measured"];
  writer.contract.products = [{ id: "measured", lifetime: "run", composition }];
  return writer;
}
it("rejects distinct exclusive providers in preflight and before the second runtime operation", async () => {
  const first = provider("first"),
    second = provider("second");
  let called = false;
  second.behavior = {
    kind: "model-pass",
    applyPass() {
      called = true;
    },
  };
  const registry = new MapProcessRegistry().register(first).register(second);
  const plan = configuration([invoke(first), invoke(second)]);
  expect(preflight(plan, registry)).toEqual([
    expect.objectContaining({ message: expect.stringContaining("exclusively produce measured") }),
  ]);
  await expect(new MapRunner(plan, registry).run(landscape(), options)).rejects.toThrow(
    "exclusively produce measured"
  );
  expect(called).toBe(false);
});
it("allows repeated occurrences of one exclusive provider and distinct shared-state writers", async () => {
  const only = provider("only");
  const same = new MapProcessRegistry().register(only);
  const repeated = configuration([invoke(only, "first"), invoke(only, "second")]);
  expect(preflight(repeated, same)).toEqual([]);
  await expect(new MapRunner(repeated, same).run(landscape(), options)).resolves.toBeDefined();
  const first = provider("first", "shared-state"),
    second = provider("second", "shared-state");
  const shared = new MapProcessRegistry().register(first).register(second);
  const plan = configuration([invoke(first), invoke(second)]);
  expect(preflight(plan, shared)).toEqual([]);
  await expect(new MapRunner(plan, shared).run(landscape(), options)).resolves.toBeDefined();
});
it("does not count a conditional exclusive provider that cannot execute in this recipe", async () => {
  const first = provider("first"),
    second = provider("second");
  const registry = new MapProcessRegistry().register(first).register(second);
  const plan = configuration([
    {
      kind: "epochs",
      id: "history",
      resetFacts: [],
      epochs: [epoch("one", 1, { provider: "first" })],
      body: [
        { ...invoke(first), when: { variable: "provider", equals: "first" } },
        { ...invoke(second), when: { variable: "provider", equals: "second" } },
      ],
    },
  ]);
  expect(preflight(plan, registry)).toEqual([]);
  await expect(new MapRunner(plan, registry).run(landscape(), options)).resolves.toBeDefined();
});
