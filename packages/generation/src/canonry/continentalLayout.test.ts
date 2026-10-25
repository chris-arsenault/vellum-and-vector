import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField } from "./field";
import { landmasses } from "./geography";
import { metricSearch } from "./metricSearch";
import { initialSteps } from "./sequence";
import { createWorldMesh } from "./worldMesh";
import { continentalWorldProfile } from "./worldScale";

function layout(seed: number, clustering: number, landFraction: number) {
  const bounds: [number, number, number, number] = [0, 0, 4e6, 3e6];
  const profile = continentalWorldProfile(
    atlasPhysicalProfile(
      { provinces: 42, landFraction },
      { ContinentalAssemblyClustering: clustering }
    ),
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
  return { water: water / total, wide: wide / total, compound };
}

it.each([0.35, 0.48])(
  "leaves broad ocean interiors alongside compound continents at land fraction %s",
  (landFraction) => {
    let grouped = 0,
      dispersed = 0,
      compound = 0;
    for (const seed of [73, 104729, 42, 157]) {
      const continental = layout(seed, 1, landFraction),
        scattered = layout(seed, 0, landFraction);
      expect(continental.water).toBeGreaterThan(1 - landFraction - 0.04);
      expect(continental.water).toBeLessThan(1 - landFraction + 0.04);
      grouped += continental.wide;
      dispersed += scattered.wide;
      compound += Number(continental.compound);
    }
    expect(grouped / 4).toBeGreaterThan(0.12);
    expect(grouped).toBeGreaterThan(dispersed * 1.5);
    expect(compound).toBeGreaterThanOrEqual(3);
  }
);
