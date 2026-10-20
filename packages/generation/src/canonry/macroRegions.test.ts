import { expect, it } from "vitest";
import { macroFixture } from "./macroFixtures";
import { nearestTriangle } from "./mesh";
import { reconstructRegion, macroComponents } from "./macroRegions";
import { connectHabitatCores } from "./macroCorridors";

it("contracts isolated debris while keeping a connected regional body", () => {
  const mesh = macroFixture().physical!.map.mesh,
    debris = nearestTriangle(mesh, 85_000, 75_000),
    mask = Uint8Array.from(mesh.x, (x, i) =>
      Number(Math.hypot(x + 25_000, mesh.y[i]) < 50_000 || i === debris)
    ),
    result = reconstructRegion(mesh, mask, () => true, 35_000).mask;
  expect(result[debris]).toBe(0);
  expect(result[nearestTriangle(mesh, -25_000, 0)]).toBe(1);
});
it("keeps a lagoon connected to open water through a narrow original passage", () => {
  const mesh = macroFixture().physical!.map.mesh,
    center = nearestTriangle(mesh, 0, 0),
    mask = Uint8Array.from(mesh.x, (x, i) =>
      Number(
        Math.hypot(x, mesh.y[i]) < 80_000 &&
          Math.hypot(x, mesh.y[i]) > 18_000 &&
          !(x > 0 && Math.abs(mesh.y[i]) < 5000)
      )
    ),
    result = reconstructRegion(mesh, mask, () => true, 25_000).mask,
    lagoon = macroComponents(mesh, (i) => !result[i]).find((cells) => cells.includes(center))!;
  expect(lagoon.some((i) => Boolean(mesh.boundary[i]))).toBe(true);
});
it("routes a habitat connection around a barrier instead of joining cores across water", () => {
  const mesh = macroFixture().physical!.map.mesh,
    admits = (i: number) => !(Math.abs(mesh.x[i]) < 10_000 && mesh.y[i] < 35_000),
    cells = Array.from(mesh.x.keys()).filter(admits),
    cores = [nearestTriangle(mesh, -50_000, 0), nearestTriangle(mesh, 50_000, 0)],
    corridor = connectHabitatCores(mesh, cells, cores, new Float64Array(mesh.count).fill(1));
  expect(cores.every((i) => corridor[i])).toBe(true);
  expect(cells.some((i) => corridor[i] && mesh.y[i] > 35_000)).toBe(true);
  expect(Array.from(corridor.keys()).every((i) => !corridor[i] || admits(i))).toBe(true);
  expect(macroComponents(mesh, (i) => Boolean(corridor[i])).length).toBe(1);
});
