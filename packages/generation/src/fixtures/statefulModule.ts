/** Test-only module, imported explicitly by extension acceptance fixtures. */
import { z } from "zod";
import { builtinLayers, putChannel, rectangle } from "@atlas/domain";
import type { GenerationModule } from "../generationModules";
import { generationBindings } from "../generationBindings";
import type { GenerationState, MapProcess, MapProcessContext } from "../process";
import { landscape } from "../mapFixtures";
import type { AtlasGenerationInput } from "../atlasWorkflow";

export const inventoryFeature = "test.carried-inventory";
export const inventoryChannel = "testInventory";
export const inventoryLayer = "test-inventory";
const carriedChannel = "test:carriedInventory";
const inventoryProduct = "test:inventory";
const configurationSchema = z
  .object({
    initialDensity: z.number().finite().nonnegative(),
    epochRates: z.record(z.string(), z.number().finite().nonnegative()),
  })
  .strict();

function settings(context: MapProcessContext) {
  return configurationSchema.parse(
    generationBindings(context).features.selection[inventoryFeature].configuration
  );
}
function initializeInventory(state: GenerationState, context: MapProcessContext) {
  const { initialDensity } = settings(context);
  putChannel(
    state.surface,
    carriedChannel,
    "kilogram",
    Float64Array.from(state.surface.measures, (area, i) =>
      state.surface.active[i] ? area * initialDensity : 0
    ),
    "extensive"
  );
}
function advanceInventory(state: GenerationState, context: MapProcessContext, years: number) {
  const epoch = context.epochs.at(-1)!,
    multiplier = settings(context).epochRates[epoch.id] ?? 1,
    density = Number(context.parameters.deposition) * multiplier * years;
  const grid = state.surface;
  for (let i = 0; i < grid.active.length; i++)
    if (grid.active[i]) grid.channels[carriedChannel][i] += grid.measures[i] * density;
  context.recordCause({
    kind: "domain",
    process: "test.inventory.advance",
    subjects: [],
    description: `${epoch.id}: accumulated ${density} kilograms per square metre over ${years} years.`,
  });
}
function extractInventory(state: GenerationState) {
  putChannel(
    state.surface,
    inventoryChannel,
    "kilogram",
    state.surface.channels[carriedChannel].slice(),
    "extensive"
  );
}

export const statefulInventoryModule: GenerationModule = {
  id: "test.stateful-inventory-module",
  features: [
    {
      id: inventoryFeature,
      label: "Carried inventory",
      domains: ["physical"],
      defaultEnabled: true,
      settings: {
        deposition: {
          label: "Inventory deposition",
          unit: "kilogram/metre²/year",
          minimum: 0,
          maximum: 10,
          default: 2,
          step: 0.1,
          group: "ecology",
        },
      },
      configuration: configurationSchema,
      configurationFromLegacy: () => ({ initialDensity: 1, epochRates: {} }),
      processes: ["test.inventory.initialize", "test.inventory.advance", "test.inventory.extract"],
      slots: ["initialize.influences", "epoch.storage", "present.products"],
      contribute(slot) {
        const operations: Record<string, string> = {
          "initialize.influences": "test.inventory.initialize",
          "epoch.storage": "test.inventory.advance",
          "present.products": "test.inventory.extract",
        };
        const process = operations[slot];
        return process ? [{ kind: "process", id: "inventory", process, version: "1" }] : [];
      },
    },
  ],
  processes: (): MapProcess[] => [
    {
      contract: {
        id: "test.inventory.initialize",
        version: "1",
        parameters: {},
        requires: [],
        produces: [inventoryProduct],
        invalidates: [],
        products: [
          {
            id: inventoryProduct,
            lifetime: "run",
            representation: "field",
            unit: "kilogram",
            composition: "shared-state",
          },
        ],
      },
      behavior: {
        kind: "initialize",
        initialize: initializeInventory,
      },
      validate: () => [],
    },
    {
      contract: {
        id: "test.inventory.advance",
        version: "1",
        parameters: {
          deposition: { type: "number", unit: "kilogram/metre²/year", required: true, minimum: 0 },
        },
        requires: [inventoryProduct],
        produces: [inventoryProduct],
        invalidates: [],
      },
      behavior: {
        kind: "elapsed",
        duration: { kind: "epoch", fraction: 1 },
        advance: advanceInventory,
      },
      validate: () => [],
    },
    {
      contract: {
        id: "test.inventory.extract",
        version: "1",
        parameters: {},
        requires: [inventoryProduct],
        produces: ["test:inventory-output"],
        invalidates: [],
        products: [
          {
            id: "test:inventory-output",
            lifetime: "run",
            representation: "field",
            unit: "kilogram",
            composition: "exclusive",
          },
        ],
      },
      behavior: {
        kind: "extract",
        extract: extractInventory,
      },
      validate: () => [],
    },
  ],
  publications: (input) => [
    {
      kind: "field",
      channel: carriedChannel,
      unit: "kilogram",
      quantity: "extensive",
      publish: false,
      owners: [inventoryFeature],
      layer: {
        ...builtinLayers().find((layer) => layer.id === "climate")!,
        id: inventoryLayer,
        name: "Carried inventory",
        facts: [inventoryChannel],
        schema: {},
        generator: "physical",
      },
    },
    {
      kind: "field",
      channel: inventoryChannel,
      unit: "kilogram",
      quantity: "extensive",
      publish: input.resolvedFeatures!.selection[inventoryFeature].enabled,
      owners: [inventoryFeature],
      layer: {
        ...builtinLayers().find((layer) => layer.id === "climate")!,
        id: inventoryLayer,
        name: "Carried inventory",
        facts: [inventoryChannel],
        schema: {},
        generator: "physical",
      },
    },
  ],
};

export function statefulInventoryRequest(deposition = 2) {
  const source = landscape().domain,
    footprint = rectangle([0, 0, 3_000_000, 2_000_000]);
  source.world.id = source.scope.worldId = "00112233-4455-6677-8899-aabbccddeeff";
  source.scope.footprint = footprint;
  source.world.reference.domain = footprint;
  source.world.areas.area.footprint = footprint;
  source.world.epochs = [
    {
      id: "Formation",
      duration: 2,
      tectonics: 1,
      hydrology: 1,
      ice: 1,
      coasts: 1,
      temperature: 15,
      seaLevel: 0,
    },
    {
      id: "Recent",
      duration: 3,
      tectonics: 1,
      hydrology: 1,
      ice: 1,
      coasts: 1,
      temperature: 15,
      seaLevel: 0,
    },
  ];
  source.world.magicSystems = [];
  source.world.humanEras = [];
  const input: AtlasGenerationInput = {
    areaId: "area",
    seed: 73,
    quality: "draft",
    domains: ["physical"],
    features: {
      // This fixture accepts module rebinding and carried inventory. Complete
      // causal ecology and selectable regions have separate world acceptance.
      "ecology.living": { enabled: false },
      [inventoryFeature]: {
        enabled: true,
        settings: { deposition },
        configuration: { initialDensity: 1, epochRates: { Formation: 1, Recent: 2 } },
      },
    },
  };
  return { source, input };
}
