import { expect, it } from "vitest";
import { canonryMagicPresets, type MagicSystem } from "@atlas/domain";
import { configuredPhysicalProfile } from "../../packages/generation/src/physicalProfileConfiguration";
import { atlasPhysicalProfile } from "../../packages/generation/src/canonry/atlasProfile";
import {
  newGenerationDraft,
  normalizeGenerationRecipe,
  prepareDraft,
  setFeatureSetting,
  updateFeature,
} from "./generationDraft";
import {
  applyCartographicChoice,
  cartographicControls,
  cartographicValue,
} from "./cartographicDraft";
import { setDraftMagicSystems, draftEpochs, renameDraftEpoch } from "./generationDraftEpochs";

const control = (id: string) => cartographicControls().find((control) => control.id === id)!;
const choose = (draft: ReturnType<typeof newGenerationDraft>, id: string, value: string) =>
  applyCartographicChoice(draft, control(id), value);

it("prepares every curated outcome through schemas, process dependencies and native profile bindings", () => {
  const base = newGenerationDraft();
  for (const definition of cartographicControls())
    for (const choice of definition.choices) {
      const draft = applyCartographicChoice(base, definition, choice.id);
      const prepared = prepareDraft(draft);
      expect(
        prepared.diagnostics.filter((item) => item.severity === "error"),
        `${definition.id}:${choice.id}`
      ).toEqual([]);
      expect(cartographicValue(draft, definition)).toBe(choice.id);
    }
});

it("uses meaningful reference choices while preserving the authored magic recipes", () => {
  const draft = newGenerationDraft();
  for (const definition of cartographicControls().filter((entry) => entry.defaultChoice))
    expect(cartographicValue(draft, definition)).toBe(definition.defaultChoice);
  expect(prepareDraft(draft).input.settings!.magicSystems).toEqual(canonryMagicPresets());
});

it("defaults to compound continents and keeps island-world assemblies dispersed", () => {
  const configured = (draft: ReturnType<typeof newGenerationDraft>) => {
    const prepared = prepareDraft(draft);
    return atlasPhysicalProfile(
      prepared.input.parameters,
      configuredPhysicalProfile(prepared.input.resolvedFeatures!)
    );
  };
  expect(configured(newGenerationDraft())).toMatchObject({
    ContinentalAssemblyCount: 4,
    TectonicProvinceCount: 42,
    ContinentalCrustFraction: 0.35,
    ContinentalAssemblyClustering: 1,
    QualityTargets: { OceanCoverage: { target: 0.65 } },
  });
  expect(prepareDraft(newGenerationDraft()).input.parameters!.mapBoundary).toBe(1);
  expect(configured(choose(newGenerationDraft(), "land-and-sea", "islands"))).toMatchObject({
    ContinentalAssemblyCount: 10,
    ContinentalAssemblyClustering: 0,
  });
});

it("rejects unowned coefficients and invalid physical coefficient dimensions at the recipe boundary", () => {
  for (const [owner, key, value] of [
    ["physical.coastal-construction", "CoastalDetailScale", 0],
    ["physical.volcanism", "MantlePlumeCount", 1.5],
    ["physical.impacts", "ImpactPrimordialShare", 1001],
    ["physical.foundation", "ContinentalAssemblySeparationDepth", 2],
    ["physical.foundation", "DeltaMaximumRadius", 4000],
  ] as const)
    expect(() =>
      prepareDraft(
        updateFeature(newGenerationDraft(), owner, { configuration: { profile: { [key]: value } } })
      )
    ).toThrow();
});

it("composes terrain, shore, climate and ecological history independently of selection order", () => {
  const choices = [
    ["land-and-sea", "islands"],
    ["terrain", "glacial"],
    ["shoreline", "inlets"],
    ["warmth", "warmer"],
    ["living-landscape", "humid"],
  ];
  const base = newGenerationDraft();
  const forward = choices.reduce((draft, [id, value]) => choose(draft, id, value), base);
  const reverse = [...choices]
    .reverse()
    .reduce((draft, [id, value]) => choose(draft, id, value), base);
  const first = normalizeGenerationRecipe(forward.recipe),
    second = normalizeGenerationRecipe(reverse.recipe);
  expect(first).toEqual(second);
  expect(first.settings.epochs.map((epoch) => epoch.id)).toEqual([
    "Formation",
    "Cold age",
    "Present",
  ]);
  expect(first.settings.epochs[1]).toMatchObject({
    temperature: -20,
    seaLevel: -60,
    ice: 1,
    ecology: { seasonality: 0.2, rainfall: 0.8, productivity: 0.4, migration: 0.5, recovery: 1.5 },
  });
  expect(first.settings.epochs[1].ecology!.fire).toBeCloseTo(0.07);
  expect(first.settings.epochs[2]).toMatchObject({
    duration: 200,
    temperature: 15,
    ecology: { productivity: 1.2, migration: 1.5, recovery: 4.5, fire: 0.35 },
  });
  expect(first.parameters).toMatchObject({
    temperature: 23,
    seaLevel: 60,
    rainfall: 2,
    vegetation: 2.5,
  });
  // Repeated normalization cannot multiply either baseline or history again.
  expect(normalizeGenerationRecipe(first)).toEqual(first);
});

it("passes all owned native coefficients into the actual physical profile, preserving other decisions", () => {
  let draft = choose(newGenerationDraft(), "terrain", "ranges");
  draft = choose(draft, "land-and-sea", "islands");
  draft = choose(draft, "shoreline", "flats");
  const prepared = prepareDraft(draft);
  const profile = atlasPhysicalProfile(
    prepared.input.parameters,
    configuredPhysicalProfile(prepared.input.resolvedFeatures!)
  );
  expect(profile).toMatchObject({
    ContinentalAssemblyCount: 10,
    ContinentalWarpStrength: 260_000,
    InteriorReliefStrength: 0.25,
    InitialOrogenicConstructionStep: 3600,
    FluvialEquilibriumGradient: 0.0004,
    FloodplainMaximumWidth: 8_000,
    CoastalDepositionReach: 35_000,
    DeltaMaximumRadius: 45_000,
    CoastalDetailPassiveAmplitude: 62 * 0.35,
  });
  expect(cartographicValue(draft, control("terrain"))).toBe("ranges");
  expect(cartographicValue(draft, control("land-and-sea"))).toBe("islands");
  draft = setFeatureSetting(draft, "physical.climate", "temperature", 22);
  expect(cartographicValue(draft, control("warmth"))).toBe("custom");
  expect(cartographicValue(draft, control("terrain"))).toBe("ranges");
});

it("keeps renamed clock identities, other systems and authored activity when applying curated outcomes", () => {
  let draft = renameDraftEpoch(newGenerationDraft(), "Cold age", "Long winter");
  const before = draftEpochs(draft);
  draft = choose(draft, "terrain", "glacial");
  expect(prepareDraft(draft).input.settings!.epochs.map((epoch) => epoch.id)).toEqual(
    before.map((epoch) => epoch.id)
  );
  const systems = canonryMagicPresets();
  systems[2].enabled = false;
  systems[0].history.storage = 0.3;
  draft = setDraftMagicSystems(draft, systems);
  draft = choose(draft, "fire.reach", "2");
  draft = choose(draft, "aurora.capture", "0");
  const configured = normalizeGenerationRecipe(draft.recipe).settings.magicSystems;
  expect(configured[2]).toEqual(systems[2]);
  expect(configured[0].history).toEqual(systems[0].history);
  expect(configured[0].parameters).toMatchObject({ baseCost: 1.5, conductanceDivisor: 20 });
  expect(configured[1].parameters).toMatchObject({
    iceRetention: 600,
    coldRetentionDistance: 4_000,
  });
  expect(configured.map((entry) => entry.id)).toEqual(["fire", "aurora", "pressure", "greenwood"]);
});

it("prepares all eight magic inclusion combinations without silently reactivating omitted systems", () => {
  for (let mask = 0; mask < 8; mask++) {
    const systems = canonryMagicPresets().map((system, index) => ({
      ...system,
      enabled: Boolean(mask & (1 << index)),
    }));
    const draft = setDraftMagicSystems(newGenerationDraft(), systems);
    const prepared = prepareDraft(draft);
    expect(
      prepared.diagnostics.filter((entry) => entry.severity === "error"),
      String(mask)
    ).toEqual([]);
    expect(prepared.input.settings!.magicSystems).toEqual(systems);
    expect(prepared.input.resolvedFeatures!.selection["physical.ocean-circulation"].enabled).toBe(
      true
    );
    expect(prepared.input.resolvedFeatures!.selection["physical.land-ice"].enabled).toBe(true);
  }
});

it("keeps curated controls free of process-enable vectors and universal magical identity menus", () => {
  for (const definition of cartographicControls())
    for (const choice of definition.choices)
      expect(Object.values(choice.features).every((feature) => feature.enabled === undefined)).toBe(
        true
      );
  const magic = cartographicControls().filter((entry) => entry.system);
  expect(magic.filter((entry) => entry.system === "fire")).toHaveLength(4);
  expect(magic.filter((entry) => entry.system === "aurora")).toHaveLength(4);
  expect(magic.filter((entry) => entry.system === "pressure")).toHaveLength(5);
  // Each system acts on the living through its own medium, not a generic growth term.
  const systems = newGenerationDraft().recipe.features!["magic.configured"].configuration!
    .magicSystems as unknown as MagicSystem[];
  const effects = (id: string) => systems.find((entry) => entry.id === id)!.effects;
  expect(effects("fire").quickening).toBeGreaterThan(0);
  expect(effects("aurora").stillness).toBeGreaterThan(0);
  expect(effects("aurora").vegetationGrowth).toBe(0);
  expect(effects("pressure").fog).toBeGreaterThan(0);
  expect(systems.every((entry) => entry.effects.vegetationGrowth === 0)).toBe(true);
});
