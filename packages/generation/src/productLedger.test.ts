import { mapCommand } from "./processTraits";
import { expect, it } from "vitest";
import { generateBand } from "@atlas/domain";
import { ProductLedger } from "./productLedger";
import { MapRunner } from "./mapRunner";
import { preflight } from "./preflight";
import { configuration, epoch, invoke, landscape, options } from "./mapFixtures";
import { MapProcessRegistry, type MapProcess, type GenerationState } from "./process";
import { createTestField as createField } from "./rock/groundTestFixture";
import { createMesh } from "./world/mesh";
import { atlasPhysicalProfile } from "./world/atlasProfile";

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
    operation: mapCommand("contract-probe", "event", apply, []),
    validate: () => [],
  };
}
it("distinguishes produced, missing and stale products", () => {
  const ledger = new ProductLedger(new Set());
  expect(ledger.status("impacts")).toBe("missing");
  expect(ledger.accepts("impacts")).toBe(false);
  ledger.invalidate("impacts", "terrain");
  expect(ledger.status("impacts")).toBe("stale");
  ledger.produce("impacts");
  expect(ledger.status("impacts")).toBe("available");
  expect(ledger.accepts("impacts")).toBe(true);
});
function nativeState(): GenerationState {
  const state = landscape(),
    map = createField(createMesh(32, 0));
  map.Elevation.fill(-1024);
  state.physical = {
    map,
    profile: atlasPhysicalProfile({}, {}, map.scale),
    samples: generateBand(
      state.surface.coverage,
      "int32",
      "physical:samples",
      () => 0,
      state.surface.active.length
    ),
    grid: state.surface.coverage,
    fixed: [],
    inherited: false,
  };
  return state;
}
it("lets a step run once a selected step wrote what it needs, and skips it otherwise", async () => {
  const writes = process("writes-ocean");
  writes.contract.produces = ["field:WaterKindCodes"];
  let ran = 0;
  const needs = process("needs-ocean", () => {
    ran++;
  });
  needs.contract.requires = ["field:WaterKindCodes"];
  const registry = new MapProcessRegistry().register(writes).register(needs),
    alone = await new MapRunner(configuration([invoke(needs)]), registry).run(
      nativeState(),
      options
    );
  expect(alone.state.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "stale_fact",
      resource: "field:WaterKindCodes",
      outcome: "skipped",
    })
  );
  expect(ran).toBe(0);
  await new MapRunner(configuration([invoke(writes), invoke(needs)]), registry).run(
    nativeState(),
    options
  );
  expect(ran).toBe(1);
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
  second.operation = mapCommand(
    second.contract.id,
    "event",
    () => {
      called = true;
    },
    []
  );
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
