import { expect, it } from "vitest";
import { allocateProvinceCrust, nextContinentalProvince } from "./provinceSites";

const site = (x: number, y: number) => ({ x, y, priority: 0 });
function contacts(count: number, edges: number[][]) {
  const adjacent = new Uint8Array(count * count);
  for (const [a, b] of edges) adjacent[a * count + b] = adjacent[b * count + a] = 1;
  return adjacent;
}
const settings = {
  ContinentalAssemblyCount: 1,
  ContinentalCrustFraction: 0.5,
  ContinentalAssemblyClustering: 1,
  ContinentalAssemblyGrowthVariation: 0,
  ContinentalMajorAssemblies: 1,
  ContinentalMajorGrowth: 2,
  OceanicPlateCount: 1,
  OceanicPlateWaterShare: 1,
};

it("accretes around the nucleus instead of extending a close frontier into a long branch", () => {
  const sites = [site(0, 0), site(1, 0), site(0, 1), site(2, 0)],
    selected = Int32Array.of(1, 1, 0, 0),
    adjacent = contacts(4, [
      [0, 1],
      [0, 2],
      [1, 3],
    ]);
  expect(
    nextContinentalProvince(sites, selected, 1, 0, 0, { seed: 17, cohesion: 1, adjacent })
  ).toBe(2);
});

it("uses wrapped accretion distances without favoring the chart seam", () => {
  const sites = [site(9.5, 0), site(0.5, 0), site(7.5, 0)],
    selected = Int32Array.of(1, 0, 0),
    material = {
      seed: 17,
      cohesion: 1,
      adjacent: contacts(3, [
        [0, 1],
        [0, 2],
      ]),
    };
  expect(nextContinentalProvince(sites, selected, 1, 0, 10, material)).toBe(1);
  expect(nextContinentalProvince(sites, selected, 1, 0, 0, material)).toBe(2);
});

it("ranks eligible contacts instead of stopping at an oversized nearest province", () => {
  const sites = [site(0, 0), site(1, 0), site(2, 0)],
    areas = [1, 10, 2],
    selected = Int32Array.of(1, 0, 0),
    material = {
      seed: 17,
      cohesion: 1,
      adjacent: contacts(3, [
        [0, 1],
        [0, 2],
      ]),
    };
  expect(
    nextContinentalProvince(sites, selected, 1, 0, 0, material, (i) => Math.abs(2 - areas[i]) < 2)
  ).toBe(2);
});

it("does not jump a blocked accretion front, while dispersed fragments may form separately", () => {
  const sites = [site(0, 0), site(1, 0), site(2, 0)],
    selected = Int32Array.of(1, 2, 0),
    material = {
      seed: 17,
      cohesion: 1,
      adjacent: contacts(3, [
        [0, 1],
        [1, 2],
      ]),
    };
  expect(nextContinentalProvince(sites, selected, 1, 0, 0, material)).toBe(-1);
  expect(nextContinentalProvince(sites, selected, 1, 0, 0, { ...material, cohesion: 0 })).toBe(2);
});

const sites = [site(0, 0), site(1, 0), site(2, 0), site(2, 1), site(1, 1), site(0, 1)];
const territory = {
  areas: Float64Array.of(1, 1, 1, 1, 1, 1),
  adjacent: contacts(6, [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 0],
  ]),
};

it("groups ocean plates only in the crust left outside continental assemblies", () => {
  const { continents, oceans } = allocateProvinceCrust(sites, territory, settings, 17, 0);
  expect([...continents]).toContain(1);
  expect([...oceans]).toContain(1);
  for (let i = 0; i < sites.length; i++)
    expect(continents[i] > 0 ? oceans[i] === 0 : oceans[i] > 0).toBe(true);
});

it("does not force continental nuclei when no continental material is allocated", () => {
  const { continents, oceans } = allocateProvinceCrust(
    sites,
    territory,
    { ...settings, ContinentalCrustFraction: 0 },
    17,
    0
  );
  expect([...continents]).toEqual([0, 0, 0, 0, 0, 0]);
  expect([...oceans]).toEqual([1, 1, 1, 1, 1, 1]);
});

it("does not reserve an ocean province when all crust is continental", () => {
  const { continents, oceans } = allocateProvinceCrust(
    sites,
    territory,
    { ...settings, ContinentalCrustFraction: 1 },
    17,
    0
  );
  expect([...continents]).toEqual([1, 1, 1, 1, 1, 1]);
  expect([...oceans]).toEqual([0, 0, 0, 0, 0, 0]);
});

it("allows ocean crust without forcing it into an exclusively oceanic plate", () => {
  const { continents, oceans } = allocateProvinceCrust(
    sites,
    territory,
    { ...settings, OceanicPlateWaterShare: 0 },
    17,
    0
  );
  expect([...continents]).toContain(0);
  expect([...oceans]).toEqual([0, 0, 0, 0, 0, 0]);
});
