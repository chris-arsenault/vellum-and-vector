import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField } from "./field";
import { landmasses } from "./geography";
import { metricSearch } from "./metricSearch";
import { initialSteps } from "./sequence";
import { createWorldMesh } from "./worldMesh";
import { continentalWorldProfile } from "./worldScale";
import { nearestTriangle } from "./mesh";

function layout(seed: number, landFraction: number) {
  const bounds: [number, number, number, number] = [0, 0, 4e6, 3e6];
  const profile = continentalWorldProfile(
    atlasPhysicalProfile({ provinces: 42, landFraction }),
    bounds
  );
  const map = createField(createWorldMesh(bounds, 8192, 0, undefined, undefined, undefined, true));
  for (const [, salt, apply] of initialSteps)
    apply(map, physicalContext(seed, salt, profile, null, 0, 3));
  landmasses(map, physicalContext(seed, 0, profile));
  const distance = new Float64Array(map.mesh.count).fill(Infinity),
    roots: number[] = [];
  const masses = new Map<number, Map<number, number>>();
  let total = 0,
    water = 0,
    wide = 0;
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes[i] !== 1) {
      distance[i] = 0;
      roots.push(i);
    }
  metricSearch(map.mesh, roots, distance, Infinity, () => {});
  for (let i = 0; i < map.mesh.contentCount; i++) {
    const area = map.mesh.contentAreas[i];
    total += area;
    if (map.WaterKindCodes[i] === 1) {
      water += area;
      if (distance[i] > 500_000) wide += area;
    } else if (map.LandmassIds[i] > 0) {
      const mass = masses.get(map.LandmassIds[i]) ?? new Map<number, number>();
      const assembly = map.CrustAssemblyIds[i];
      mass.set(assembly, (mass.get(assembly) ?? 0) + area);
      masses.set(map.LandmassIds[i], mass);
    }
  }
  // A compound landmass must contain substantial material from multiple assemblies,
  // rather than merely touch a stray transported cell with a different identity.
  const compound = [...masses.values()].some(
    (mass) => [...mass].filter(([id, area]) => id > 0 && area / total > 0.03).length >= 2
  );
  const areas = [...masses.values()].map((mass) =>
    [...mass.values()].reduce((sum, area) => sum + area, 0)
  );
  const land = areas.reduce((sum, area) => sum + area, 0);
  return {
    water: water / total,
    wide: wide / total,
    compound,
    continents: areas.filter((area) => area / land >= 0.1).length,
    dominant: Math.max(...areas) / land,
  };
}

it.each([0.35, 0.48])("retains the requested ocean budget at land fraction %s", (landFraction) => {
  for (const seed of [73, 104729, 42, 157]) {
    const continental = layout(seed, landFraction);
    expect(continental.water).toBeGreaterThan(1 - landFraction - 0.04);
    expect(continental.water).toBeLessThan(1 - landFraction + 0.04);
  }
});

it("usually separates substantial continents while retaining compound crust and broad ocean", () => {
  const seeds = [73, 104729, 42, 157, 271828, 65537, 7, 19];
  const worlds = seeds.map((seed) => layout(seed, 0.35));
  // Each substantial continent holds at least a tenth of all dry land. Islands cannot
  // make a nearly complete supercontinent pass the distribution check.
  expect(worlds.filter((world) => world.continents >= 2).length).toBeGreaterThanOrEqual(6);
  expect(worlds.reduce((sum, world) => sum + world.dominant, 0) / worlds.length).toBeLessThan(0.8);
  expect(worlds.filter((world) => world.compound).length).toBeGreaterThanOrEqual(6);
  expect(worlds.reduce((sum, world) => sum + world.wide, 0) / worlds.length).toBeGreaterThan(0.15);
  const defaultWorld = worlds[seeds.indexOf(104729)];
  expect(defaultWorld.continents).toBeGreaterThanOrEqual(2);
  expect(defaultWorld.dominant).toBeLessThan(0.8);
});

it("counts pieces on opposite chart edges as one landmass when the cylinder joins them", () => {
  const map = createField(
    createWorldMesh([0, 0, 4e6, 3e6], 4096, 0, undefined, undefined, undefined, true)
  );
  const dryAt = (x: number, y: number) =>
    (Math.abs(x) > 1.5e6 && Math.abs(y) < 500_000) ||
    (Math.abs(x) < 300_000 && Math.abs(y) < 300_000);
  for (let i = 0; i < map.mesh.count; i++) {
    const dry = dryAt(map.mesh.x[i], map.mesh.y[i]);
    map.WaterKindCodes[i] = dry ? 0 : 1;
    map.Elevation[i] = dry ? 1024 : -1024;
  }
  landmasses(map, physicalContext(73, 0, atlasPhysicalProfile()));
  const left = nearestTriangle(map.mesh, -1.9e6, 0),
    right = nearestTriangle(map.mesh, 1.9e6, 0),
    center = nearestTriangle(map.mesh, 0, 0);
  expect(map.LandmassIds[left]).toBeGreaterThan(0);
  expect(map.LandmassIds[left]).toBe(map.LandmassIds[right]);
  expect(map.LandmassIds[center]).not.toBe(map.LandmassIds[left]);
  expect(new Set(map.LandmassIds).size).toBe(3); // Ocean zero and two dry bodies.
});
