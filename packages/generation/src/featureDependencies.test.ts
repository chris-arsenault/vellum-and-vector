import { expect, it } from "vitest";
import { landscape } from "./mapFixtures";
import { prepareAtlasGeneration } from "./atlasWorkflow";
import { magicSystemSchema } from "@atlas/domain";
import { configuredMagicRequirements } from "./featureDependencies";
import { magicProcesses } from "./canonry/magicProcesses";

function request(strength: number, enabled = true, outside = false) {
  const domain = landscape().domain;
  domain.world.magicSystems = [];
  domain.world.epochs = [
    {
      id: "Formation",
      duration: 1000,
      tectonics: 1,
      hydrology: 1,
      ice: 1,
      coasts: 1,
      temperature: 15,
      seaLevel: 0,
    },
  ];
  domain.world.magic = [
    {
      id: "pressure",
      name: "Pressure",
      effect: "pressure",
      source: { x: outside ? 1e12 : 0, y: 0, z: 0 },
      radius: 1e6,
      strength,
      propagation: "radial",
      decay: 0,
      storage: 0,
      dependsOn: null,
      startsAtEpoch: 0,
    },
  ];
  return prepareAtlasGeneration(domain, {
    areaId: domain.scope.areaId,
    seed: 73,
    quality: "draft",
    domains: ["physical", "magic"],
    features: {
      "physical.coastal-evolution": { enabled: false },
      "magic.local": { enabled },
    },
  });
}
it("requires the physical coastal target for active local pressure in the generated geography", () => {
  expect(request(1).diagnostics).toContainEqual(
    expect.objectContaining({
      code: "feature_dependency",
      invocation: "magic.local",
      resource: "physical.coastal-evolution",
    })
  );
  for (const prepared of [request(0), request(1, false), request(1, true, true)])
    expect(prepared.diagnostics.some((diagnostic) => diagnostic.invocation === "magic.local")).toBe(
      false
    );
});

function disabledInteraction() {
  const active = magicSystemSchema.parse({
    id: "active",
    name: "Active",
    source: "placed",
    propagation: "radial",
    phase: "climate",
  });
  const container = magicSystemSchema.parse({
    ...active,
    id: "container",
    name: "Container",
    enabled: false,
    features: [
      {
        id: "grove",
        name: "Grove",
        seeds: [
          [
            { field: "system:active", min: 1 },
            { field: "biome", values: [2] },
          ],
        ],
      },
    ],
  });
  const domain = landscape().domain;
  domain.world.magicSystems = [active, container];
  domain.world.epochs = [
    {
      id: "Formation",
      duration: 1000,
      tectonics: 1,
      hydrology: 1,
      ice: 0,
      coasts: 1,
      temperature: 15,
      seaLevel: 0,
    },
  ];
  return domain;
}

it("requires ecology for an effective independent rule inside a disabled container", () => {
  const domain = disabledInteraction();
  const prepared = prepareAtlasGeneration(domain, {
    areaId: "area",
    seed: 73,
    quality: "draft",
    domains: ["physical", "magic"],
    features: { "ecology.living": { enabled: false } },
  });
  expect(prepared.diagnostics).toContainEqual(
    expect.objectContaining({
      severity: "error",
      code: "feature_dependency",
      invocation: "magic.configured",
      resource: "ecology.living",
      field: {
        feature: "magic.configured",
        path: ["magicSystems", 1, "features", 0, "seeds", 0, 1, "field"],
      },
    })
  );
  const classify = magicProcesses(domain.world.magicSystems).find(
    (process) => process.contract.id === "canonry.magic-classify"
  )!;
  expect(classify.contract.requires).toContain("ecology");
});

it("does not require the environment for disabled rules that cannot execute", () => {
  const domain = disabledInteraction();
  domain.world.magicSystems![1].features[0].seeds[0].push({ field: "intensity", min: 1 });
  expect(configuredMagicRequirements(domain.world.magicSystems!)).toEqual([]);
  expect(
    magicProcesses(domain.world.magicSystems).find(
      (process) => process.contract.id === "canonry.magic-classify"
    )!.contract.requires
  ).not.toContain("ecology");
});

it("points coastal and ecological effect requirements at their precise owned configuration", () => {
  const system = disabledInteraction().world.magicSystems![0];
  system.effects.coastalForcing = 1;
  system.effects.fire = 0.5;
  expect(configuredMagicRequirements([system])).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        feature: "physical.coastal-evolution",
        field: {
          feature: "magic.configured",
          path: ["magicSystems", 0, "effects", "coastalForcing"],
        },
      }),
      expect.objectContaining({
        feature: "ecology.living",
        field: { feature: "magic.configured", path: ["magicSystems", 0, "effects", "fire"] },
      }),
    ])
  );
});

it("does not require coastal execution when physical epochs are absent", () => {
  const system = disabledInteraction().world.magicSystems![0];
  system.effects.coastalForcing = 1;
  expect(configuredMagicRequirements([system], false)).toEqual([]);
});

it.each(["uplift", "gravity", "fertility", "luminous"])(
  "keeps intensity-only %s valid and explains the absent physical feedback",
  (effect) => {
    const domain = disabledInteraction();
    domain.world.magicSystems = [];
    domain.world.magic = [
      {
        id: "gravity-source",
        name: "Gravity well",
        effect,
        source: { x: 1000, y: 500, z: 0 },
        radius: 2000,
        strength: 1,
        propagation: "radial",
        decay: 0,
        storage: 0,
        dependsOn: null,
        startsAtEpoch: 0,
      },
    ];
    const prepared = prepareAtlasGeneration(domain, {
      areaId: "area",
      seed: 73,
      quality: "draft",
      domains: ["physical", "magic"],
    });
    expect(prepared.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "magic_intensity_only",
        severity: "warning",
        invocation: "magic.local",
        resource: "gravity-source",
      })
    );
    expect(prepared.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual(
      []
    );
    expect(prepared.source.world.magic[0].effect).toBe(effect);
  }
);
