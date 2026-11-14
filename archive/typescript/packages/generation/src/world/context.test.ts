import { expect, it } from "vitest";
import { MapScale, type Epoch } from "@atlas/domain";
import { contextualPhysicalContext } from "./context";
import { physicalProfile } from "./profile";
import { boundPhysicalEpochIndex, physicalEpochIndex } from "../generationBindings";

const epochs: Epoch[] = [
  { id: "Formation", tectonics: 1, hydrology: 1, ice: 0, coasts: 1, temperature: 15, seaLevel: 0 },
  {
    id: "Cold",
    tectonics: 0.2,
    hydrology: 0.4,
    ice: 1,
    coasts: 1,
    temperature: -3,
    seaLevel: -0.0001,
  },
];
const scale = new MapScale(4_000_000, 3_000_000, 10_000),
  profile = scale.resolve(physicalProfile),
  source = { epochs, scale, initialized: true };

it("keeps an unbound present era neutral even when its ordinal exceeds the physical history", () => {
  const era = { ...source, ancestry: [{ id: "Formation", parentEpoch: null }], epochIndices: [99] };
  const context = contextualPhysicalContext(1, 0, profile, era);
  expect(context.EpochIndex).toBe(-1);
  expect(context.TemperatureOffset).toBe(0);
  expect(context.SeaLevelOffset).toBe(0);
  expect(boundPhysicalEpochIndex(epochs, era.ancestry)).toBeUndefined();
  // Present ecology and source eligibility deliberately read the completed final physical epoch.
  expect(physicalEpochIndex(epochs, era.ancestry)).toBe(1);
});

it("retains the explicitly bound physical forcing inside a nested human round", () => {
  const context = contextualPhysicalContext(1, 0, profile, {
    ...source,
    ancestry: [{ parentEpoch: "Cold" }, { parentEpoch: "Cold" }],
  });
  expect(context.EpochIndex).toBe(1);
  expect(context.TemperatureOffset).toBe(-180);
  expect(context.SeaLevelOffset).toBe(scale.length(-0.0001));
  expect(context.HydrologyStrength).toBe(400);
});

it("keeps regional and present reads neutral without inventing an epoch", () => {
  const context = contextualPhysicalContext(1, 0, profile, { ...source, ancestry: [] });
  expect(context.EpochIndex).toBe(-1);
  expect(context.TemperatureOffset).toBe(0);
  expect(context.SeaLevelOffset).toBe(0);
  expect(() => boundPhysicalEpochIndex(epochs, [{ parentEpoch: "Missing" }])).toThrow(
    "physical epoch"
  );
});
