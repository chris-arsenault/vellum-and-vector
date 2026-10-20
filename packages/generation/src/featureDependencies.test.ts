import { expect, it } from "vitest";
import { landscape } from "./mapFixtures";
import { prepareAtlasGeneration } from "./atlasWorkflow";

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
