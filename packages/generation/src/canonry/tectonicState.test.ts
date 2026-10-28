import { expect, it } from "vitest";
import { createAdaptiveTopology, rectangle, refineAdaptiveTopology } from "@atlas/domain";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { tectonicProvinces } from "./provinces";
import { moveTectonicSites, tectonicSites, plateOf } from "./tectonicState";
import { meshDeltaX } from "./mesh";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { remeshPhysical } from "./physicalRemesh";

const bounds: [number, number, number, number] = [0, 0, 4e6, 3e6];
const context = () => physicalContext(104729, 0x6b31e7, atlasPhysicalProfile());
const world = (samples = 1024) =>
  createField(createWorldMesh(bounds, samples, 0, undefined, undefined, undefined, true));

it("retains current sites across epochs rather than recreating their original positions", () => {
  const map = world(),
    c = context();
  tectonicProvinces(map, c);
  const before = structuredClone(map.tectonics!.sites);
  moveTectonicSites(map, 150_000);
  c.IsEvolutionEpoch = true;
  tectonicProvinces(map, c);
  map.tectonics!.sites.forEach((site, i) => {
    expect(meshDeltaX(map.mesh, site.x - before[i].x)).toBeCloseTo(site.motionX * 150_000, 5);
    expect(site.y - before[i].y).toBeCloseTo(site.motionY * 150_000, 5);
    expect(site.originX).toBe(before[i].originX);
    expect(site.originY).toBe(before[i].originY);
  });
});

it("keeps boundary geometry stable when an internal consumer uses a different process salt", () => {
  const map = world(),
    c = context();
  tectonicProvinces(map, c);
  const provinces = Array.from(map.CrustProvinceIds),
    plates = Array.from(map.CrustPlateIds);
  const internal = physicalContext(104729, 0, c.Profile);
  internal.IsEvolutionEpoch = true;
  tectonicProvinces(map, internal);
  expect(Array.from(map.CrustProvinceIds)).toEqual(provinces);
  expect(Array.from(map.CrustPlateIds)).toEqual(plates);
});

it("keeps material ancestry when a fragment has different moving membership", () => {
  const map = world(),
    c = context();
  tectonicProvinces(map, c);
  const sites = tectonicSites(map, c),
    original = sites.find((site) => site.assembly > 0)!;
  const fragment = sites.find((site) => site !== original && site.assembly === original.assembly)!;
  fragment.plate = map.tectonics!.nextPlateId++;
  map.tectonics!.plates.push(plateOf(map, sites, fragment.plate));
  const ancestry = Array.from(map.CrustAssemblyIds);
  c.IsEvolutionEpoch = true;
  tectonicProvinces(map, c);
  expect(fragment.assembly).toBe(original.assembly);
  expect(fragment.plate).not.toBe(original.plate);
  expect(Array.from(map.CrustPlateIds).some((id) => id === fragment.plate)).toBe(true);
  expect(Array.from(map.CrustAssemblyIds)).toEqual(ancestry);
});

it("initializes the same sites and mechanical state independently of terrain sampling", () => {
  const coarse = world(1024),
    fine = world(4096);
  tectonicProvinces(coarse, context());
  tectonicProvinces(fine, context());
  expect(fine.tectonics).toEqual(coarse.tectonics);
});

it("carries categorical membership and worker-local mechanics through actual remeshing", () => {
  const topology = createAdaptiveTopology(bounds, {
    maximumSize: 500_000,
    minimumSize: 500_000,
  });
  const map = createField(adaptivePhysicalMesh(topology, rectangle(bounds)));
  tectonicProvinces(map, context());
  const nextTopology = refineAdaptiveTopology(topology, [0], 250_000);
  const next = remeshPhysical(map, nextTopology, rectangle(bounds));
  expect(next.mesh.count).toBeGreaterThan(map.mesh.count);
  expect(next.tectonics).toBe(map.tectonics);
  const contentIds = (field: typeof map, band: typeof map.CrustPlateIds) => {
    const ids = new Set<number>();
    for (let i = 0; i < field.mesh.count; i++)
      if (field.mesh.membership(i) === 1) ids.add(band.get(i));
    return ids;
  };
  expect(contentIds(next, next.CrustPlateIds)).toEqual(contentIds(map, map.CrustPlateIds));
  expect(contentIds(next, next.CrustAssemblyIds)).toEqual(contentIds(map, map.CrustAssemblyIds));
});
