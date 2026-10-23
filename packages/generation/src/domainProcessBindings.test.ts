import { expect, it } from "vitest";
import { magicSystemSchema } from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import type { GenerationState, MapProcessContext } from "./process";
import { defaultAtlasParameters } from "./atlasParameters";
import { serializableBindings, type GenerationBindings } from "./generationBindings";
import { generationSettingsSchema } from "./generationSettings";
import { executeProcessBehavior } from "./processTraits";
import { createField } from "./canonry/field";
import { createMesh } from "./canonry/mesh";
import { atlasPhysicalProfile } from "./canonry/atlasProfile";
import { ecologyProcesses } from "./canonry/ecologyProcesses";
import { magicProcesses } from "./canonry/magicProcesses";
import { culturalProcess } from "./mapPeople";

function fixture(): GenerationState {
  const state = landscape(),
    map = createField(createMesh(64, 0));
  state.domain.world.id = "00112233-4455-6677-8899-aabbccddeeff";
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: new Int32Array(state.surface.active.length),
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 1000, minimumSize: 1000, featureSamples: 2 },
  };
  map.Elevation.fill(100 * 1024);
  map.BedrockElevation.set(map.Elevation);
  map.Temperature.fill(450);
  map.Moisture.fill(700);
  map.Rainfall.fill(800);
  map.RockResistance.fill(1000);
  map.DrainageElevations.set(map.Elevation);
  return state;
}
function bindings(): GenerationBindings {
  const parameters = { ...defaultAtlasParameters, vegetation: 0, grazing: 0 };
  return {
    seed: 73,
    quality: "draft",
    domains: ["physical", "magic", "cultural"],
    parameters,
    features: { parameters, selection: {}, diagnostics: [] },
    settings: generationSettingsSchema.parse({
      epochs: ["first", "last"].map((id) => ({
        id,
        duration: 4000,
        tectonics: 1,
        hydrology: 1,
        ice: 1,
        coasts: 1,
        temperature: 15,
        seaLevel: 0,
        ecology: { productivity: 0 },
      })),
      humanEras: [
        { id: "bound arrival", years: 1, mobility: 0, physicalEpoch: null, politicalCapacity: 1 },
      ],
      magicSystems: [
        magicSystemSchema.parse({
          id: "bound-system",
          name: "Bound",
          source: "placed",
          propagation: "radial",
          phase: "climate",
        }),
      ],
    }),
  };
}
function context(state: GenerationState): MapProcessContext {
  return {
    scope: state.domain.scope,
    invocation: ["bound"],
    parameters: { cultureCount: 1 },
    inputs: serializableBindings(bindings()),
    epochs: [epoch("first", 4000)],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
  };
}
it("ecology executes bound seed/settings instead of conflicting factory and world values", async () => {
  const first = fixture(),
    second = fixture();
  second.domain.world.seed = 9999;
  second.domain.world.epochs = [
    {
      id: "conflict",
      tectonics: 0,
      hydrology: 0,
      ice: 0,
      coasts: 0,
      temperature: -50,
      seaLevel: 1000,
      ecology: { productivity: 5 },
    },
  ];
  for (const [index, state] of [first, second].entries()) {
    const processes = ecologyProcesses({
      areaId: "area",
      quality: "draft",
      domains: ["physical"],
      seed: index + 1,
      parameters: { vegetation: index + 1, grazing: index + 1 },
    });
    const ctx = context(state);
    for (const name of ["initialize", "evolve", "respond", "burial", "present"])
      await executeProcessBehavior(
        processes.find((p) => p.contract.id === `atlas.ecology-${name}`)!,
        state,
        ctx
      );
    expect(state.physical!.map.Productivity.every((value) => value === 0)).toBe(true);
  }
  expect(first.physical!.map.TreeCover).toEqual(second.physical!.map.TreeCover);
  expect(first.physical!.map.SoilCarbon).toEqual(second.physical!.map.SoilCarbon);
  const processes = ecologyProcesses({
    areaId: "area",
    quality: "draft",
    domains: ["physical"],
    seed: 1,
  });
  expect(processes.find((p) => p.contract.id.endsWith("respond"))?.behavior).toMatchObject({
    kind: "elapsed",
    duration: { fraction: 0.5 },
  });
  expect(processes.find((p) => p.contract.id.endsWith("burial"))?.behavior).toMatchObject({
    kind: "elapsed",
    duration: { fraction: 1 },
  });
});
it("configured magic initializes requested systems and binds present history to requested epochs", async () => {
  const state = fixture(),
    ctx = context(state);
  state.domain.world.magicSystems = [];
  state.domain.world.epochs = [];
  const processes = magicProcesses();
  await executeProcessBehavior(
    processes.find((p) => p.contract.id.endsWith("initialize"))!,
    state,
    ctx
  );
  const field = state.physical!.magic!.fields[0];
  expect(field.definition.id).toBe("bound-system");
  field.intensity.fill(20);
  ctx.epochs = [];
  ctx.epochIndices = [];
  await executeProcessBehavior(
    processes.find((p) => p.contract.id.endsWith("history"))!,
    state,
    ctx
  );
  expect(field.history.every((value) => value === 20)).toBe(true);
  expect(field.firstEpoch.every((value) => value === 1)).toBe(true);
});
it("a disabled configured-magic feature initializes only neutral working buffers", async () => {
  const state = fixture(),
    ctx = context(state),
    bound = bindings();
  bound.features.selection["magic.configured"] = { enabled: false, settings: {} };
  ctx.inputs = serializableBindings(bound);
  await executeProcessBehavior(
    magicProcesses().find((p) => p.contract.id.endsWith("initialize"))!,
    state,
    ctx
  );
  expect(state.physical!.magic!.fields).toEqual([]);
  expect(state.physical!.magic!.heat.every((value) => value === 0)).toBe(true);
});
it("cultural spread consumes bound human history while legacy world history cannot override it", async () => {
  const first = fixture(),
    second = fixture();
  second.domain.world.humanEras = [
    { id: "ignored", years: 100000, mobility: 1000, physicalEpoch: null, politicalCapacity: 1 },
  ];
  for (const state of [first, second])
    await executeProcessBehavior(culturalProcess, state, context(state));
  const values = (state: GenerationState) =>
    Object.entries(state.surface.channels)
      .filter(([key]) => key.startsWith("culture:"))
      .map(([, value]) => [...value]);
  expect(values(first)).toEqual(values(second));
  expect(values(first).length).toBeGreaterThan(0);
  const longer = fixture(),
    longerContext = context(longer),
    history = bindings();
  history.settings.humanEras[0].years = 500;
  longerContext.inputs = serializableBindings(history);
  await executeProcessBehavior(culturalProcess, longer, longerContext);
  expect(values(longer).length).toBeGreaterThan(values(first).length);
});
it("configured rule dependencies follow their actual environmental readers", () => {
  const systems = [
    magicSystemSchema.parse({
      id: "reader",
      name: "Reader",
      source: "deep-ocean",
      propagation: "ocean-rays",
      phase: "post-glacial",
      features: [
        {
          id: "wet",
          name: "Wet",
          kind: "forest",
          seeds: [
            [
              { field: "treeCover", min: 0.1 },
              { field: "river", min: 1 },
            ],
          ],
        },
      ],
    }),
  ];
  const processes = magicProcesses(systems);
  expect(processes.find((p) => p.contract.id.endsWith("post-glacial"))!.contract.requires).toEqual(
    expect.arrayContaining(["canonry:Ocean", "canonry:Bathymetry"])
  );
  expect(processes.find((p) => p.contract.id.endsWith("classify"))!.contract.requires).toEqual(
    expect.arrayContaining(["ecology", "canonry:Rivers"])
  );
});
