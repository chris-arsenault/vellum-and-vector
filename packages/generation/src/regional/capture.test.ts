import { expect, it } from "vitest";
import { requireChannel, putChannel, residentBand } from "@atlas/domain";
import { societyChannels } from "../world/magicFieldDefinitions";
import { physicalChannels } from "../world/atlasChannels";
import { capturedEpochCount, refinementReads } from "./capture";
import { landscape } from "../mapFixtures";
import { createTestField as createField } from "../rock/groundTestFixture";
import { createMesh } from "../world/mesh";
import { atlasPhysicalProfile } from "../world/atlasProfile";
import { inheritLocalChannel, type AtlasPhysicalWorkspace } from "../world/atlasWorkspace";

it("dates local material against its pinned run rather than a later parent generation", () => {
  const { domain } = landscape();
  const epoch = {
    id: "formation",
    tectonics: 1,
    hydrology: 1,
    ice: 1,
    coasts: 1,
    temperature: 15,
    seaLevel: 0,
  };
  const run = {
    id: "captured-run",
    domains: ["physical"],
    quality: "draft",
    completedAt: "2026-01-01",
    physicalEpochs: [epoch],
  };
  domain.world.generations = [
    run,
    { ...run, id: "later-run", physicalEpochs: [epoch, { ...epoch, id: "later" }] },
  ];
  domain.world.fields.push({
    id: "captured",
    areaId: domain.scope.areaId,
    layerId: "elevation",
    samples: 1,
    algorithm: "supplied",
    input: true,
    source: { kind: "run", id: run.id },
    channels: ["Elevation"],
  });
  expect(capturedEpochCount(domain, domain.scope.areaId, true)).toBe(1);
});

it("reads every owner-published input without another regional channel list", () => {
  const { domain } = landscape(),
    names = [
      ...physicalChannels.map(({ name }) => name),
      ...societyChannels.map(([name]) => name),
      "magic:new-system:stock:retained",
      "owner-added-present-fact",
    ];
  domain.world.fields.push({
    id: "pinned",
    areaId: domain.scope.areaId,
    layerId: "physical",
    samples: 1,
    algorithm: "supplied",
    input: true,
    source: { kind: "operation", id: "supplied" },
    channels: names,
  });
  domain.world.fields.push({
    ...domain.world.fields[0],
    id: "live-parent",
    areaId: "parent",
  });
  domain.world.fields.push({
    ...domain.world.fields[0],
    id: "previous-child-output",
    input: false,
  });
  expect(refinementReads(domain, domain.scope.areaId)).toEqual([{ fieldId: "pinned", names }]);
  refinementReads(domain, domain.scope.areaId)[0].names.push("local-only");
  expect(names).not.toContain("local-only");
});

it("keeps scratch receipts outside publication while publishing retained environmental operands", () => {
  expect(physicalChannels.some(({ name }) => name === "OrganicBurialInput")).toBe(false);
  for (const name of [
    "MaximumIceThickness",
    "MaximumIceFlux",
    "MaximumGroundedIceFlux",
    "CumulativeGlacialDeposition",
    "ImpactExcavation",
    "ImpactRimUplift",
    "FogForcing",
    "ExternalHeatForcing",
  ])
    expect(
      physicalChannels.some((binding) => binding.name === name),
      name
    ).toBe(true);
});

it("resamples retained glacial evidence and fog into independent child bands", () => {
  const { surface } = landscape(),
    map = createField(createMesh(4, 0)),
    sibling = createField(createMesh(4, 0)),
    supplied = [
      ["MaximumIceThickness", 12],
      ["MaximumGroundedIceFlux", 7500],
      ["CumulativeGlacialDeposition", 3],
      ["FogForcing", 0.6],
      ["ExternalHeatForcing", -4],
    ] as const,
    workspace = (field: typeof map): AtlasPhysicalWorkspace => ({
      map: field,
      profile: atlasPhysicalProfile({}, {}, field.scale),
      samples: residentBand("int32", new Int32Array(surface.active.length)),
      grid: surface.coverage,
      fixed: [],
      inherited: true,
    });
  for (const [name, value] of supplied) {
    const binding = physicalChannels.find((candidate) => candidate.name === name)!;
    putChannel(surface, name, binding.unit, surface.coverage.scratch("float64", name).fill(value));
    inheritLocalChannel(workspace(map), surface, binding);
    inheritLocalChannel(workspace(sibling), surface, binding);
  }
  expect(map.MaximumIceThickness.get(0)).toBe(12);
  expect(map.MaximumGroundedIceFlux.get(0)).toBe(7500);
  expect(map.CumulativeGlacialDeposition.get(0)).toBe(3);
  expect(map.FogForcing.get(0)).toBeCloseTo(0.6);
  expect(map.ExternalHeatForcing.get(0)).toBe(-4);
  map.FogForcing.set(0, 0);
  map.MaximumIceThickness.set(0, 0);
  expect(sibling.FogForcing.get(0)).toBeCloseTo(0.6);
  expect(sibling.MaximumIceThickness.get(0)).toBe(12);
  expect(requireChannel(surface, "FogForcing").get(0)).toBe(0.6);
  expect(requireChannel(surface, "MaximumIceThickness").get(0)).toBe(12);
});
