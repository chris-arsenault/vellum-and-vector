import { expect, it } from "vitest";
import {
  canonryMagicPresets,
  magicSystemSchema,
  originParameters,
  validateMagicSystems,
} from "./index";

it("parses a legacy source and propagation pair into one origin and drops the pair", () => {
  const system = magicSystemSchema.parse({
    id: "warm",
    name: "Warm",
    source: "geothermal",
    propagation: "fracture",
    phase: "climate",
  });
  expect(system.origins).toEqual([
    {
      id: "geothermal",
      source: "geothermal",
      propagation: "fracture",
      renewal: "conduit-fed",
      parameters: {},
      stocks: [],
    },
  ]);
  expect("source" in system).toBe(false);
  expect("propagation" in system).toBe(false);
});
it("keeps declared origins, their renewal, parameter overrides and stocks", () => {
  const system = magicSystemSchema.parse({
    id: "fire",
    name: "Fire",
    phase: "climate",
    parameters: { baseCost: 3 },
    origins: [
      { id: "vein", source: "geothermal", propagation: "fracture", renewal: "conduit-fed" },
      {
        id: "fallen",
        source: "placed",
        propagation: "radial",
        renewal: "finite",
        parameters: { baseCost: 7 },
        stocks: [{ id: "held", reservoir: "held", carriers: ["crust", "river"] }],
      },
    ],
  });
  expect(system.origins.map((origin) => origin.id)).toEqual(["vein", "fallen"]);
  expect(originParameters(system, system.origins[0]).baseCost).toBe(3);
  expect(originParameters(system, system.origins[1]).baseCost).toBe(7);
  expect(system.origins[1].stocks[0].carriers).toEqual(["crust", "river"]);
});
it("needs either an origin or the legacy pair", () => {
  expect(() => magicSystemSchema.parse({ id: "x", name: "X", phase: "climate" })).toThrow();
});
it("rejects duplicate origin ids and unknown origin conditions, and accepts known ones", () => {
  const base = { id: "fire", name: "Fire", phase: "climate" as const };
  const origin = (id: string) => ({ id, source: "geothermal", propagation: "fracture" });
  expect(() =>
    validateMagicSystems([
      magicSystemSchema.parse({ ...base, origins: [origin("vein"), origin("vein")] }),
    ])
  ).toThrow(/distinct/);
  const rule = (field: string) => ({
    id: "r",
    name: "R",
    seeds: [[{ field, min: 1 }]],
  });
  expect(() =>
    validateMagicSystems([
      magicSystemSchema.parse({
        ...base,
        origins: [origin("vein")],
        features: [rule("source:lost")],
      }),
    ])
  ).toThrow(/Unknown/);
  expect(() =>
    validateMagicSystems([
      magicSystemSchema.parse({
        ...base,
        origins: [origin("vein")],
        features: [rule("source:vein")],
      }),
    ])
  ).not.toThrow();
});
it("gives the Canonry presets named origins that reparse unchanged", () => {
  const presets = canonryMagicPresets();
  expect(presets.map((system) => system.origins.map((origin) => origin.id))).toEqual([
    ["vein", "fallen", "forge"],
    ["field"],
    ["locus"],
    ["stand", "spring"],
    ["death", "dead-lake"],
    ["seat", "line"],
  ]);
  expect(presets[0].origins[0].stocks.map((stock) => stock.id)).toEqual(["held", "spent"]);
  expect(presets[0].origins[1].stocks[0].carriers).toEqual(["crust", "river"]);
  for (const system of presets) expect(magicSystemSchema.parse(system)).toEqual(system);
});
