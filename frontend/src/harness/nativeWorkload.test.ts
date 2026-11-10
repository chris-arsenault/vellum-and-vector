import { expect, it } from "vitest";
import { nativeWorkload } from "./nativeWorkload";
import { newGenerationDraft } from "../generationDraft";

it("derives physical workload order and invocation flags from the default atlas composition", () => {
  const entries = nativeWorkload(),
    formation = entries.filter(({ path }) => path[0].startsWith("formation/")),
    epochs = entries.filter(({ epochIndices }) => epochIndices.length);
  expect(formation.length).toBeGreaterThan(0);
  expect(formation.every(({ invocation }) => invocation.parameters?.initial)).toBe(true);
  expect(formation.at(-1)!.step[0]).toBe("geothermal");
  expect(epochs.some(({ step }) => step[0] === "crustal-support")).toBe(true);
  expect(epochs.some(({ step }) => step[0] === "ancestral-fluvial-erosion")).toBe(true);
  expect(epochs.some(({ step }) => step[0] === "orogenic-construction")).toBe(false);
  const moving = epochs.find(({ step }) => step[0] === "plate-advection")!;
  expect(moving.deformation.map(([name]) => name)).toEqual([
    "continental-sutures",
    "orogenic-construction",
    "mass-wasting",
    "crustal-support",
    "lithospheric-flexure",
  ]);
  expect(epochs.some(({ step }) => step[0] === "crustal-relaxation")).toBe(true);
  expect(entries.every(({ step, invocation }) => invocation.process === `atlas.${step[0]}`)).toBe(
    true
  );
});

it("advances ice mass once per epoch, then refreshes its load, water and flow without adding more time", () => {
  const entries = nativeWorkload(),
    epochIndices = [...new Set(entries.flatMap(({ epochIndices }) => epochIndices))];
  for (const epoch of epochIndices) {
    const steps = entries
        .filter(({ epochIndices }) => epochIndices[0] === epoch)
        .map(({ step }) => step[0]),
      balance = steps.indexOf("land-ice-mass-balance"),
      support = steps.indexOf("crustal-support", balance),
      ocean = steps.indexOf("ocean-connectivity", support),
      routing = steps.indexOf("ice-flow", ocean),
      sculpting = steps.indexOf("glacial-erosion", balance);
    expect(steps.filter((name) => name === "land-ice-mass-balance")).toHaveLength(1);
    expect(support).toBeGreaterThan(balance);
    expect(ocean).toBeGreaterThan(support);
    expect(routing).toBeGreaterThan(ocean);
    expect(sculpting).toBeGreaterThan(routing);
    expect(steps.indexOf("ocean-connectivity", sculpting)).toBeGreaterThan(sculpting);
  }
  const outsideEpochs = entries.filter(({ epochIndices }) => epochIndices.length === 0);
  expect(outsideEpochs.some(({ step }) => step[0] === "land-ice-mass-balance")).toBe(false);
  expect(outsideEpochs.some(({ step }) => step[0] === "ice-flow")).toBe(true);
});

it("binds supplied continuation epochs through the same feature configuration as the app", () => {
  const original = newGenerationDraft().recipe.settings.epochs,
    present = original.at(-1)!,
    epochs = [
      ...original,
      { ...present, id: "After magic", tectonics: 0.03 },
      { ...present, id: "Later wear", tectonics: 0 },
    ],
    entries = nativeWorkload(epochs);
  expect([...new Set(entries.flatMap((entry) => entry.epochIndices))]).toEqual([0, 1, 2, 3, 4]);
  for (const index of [3, 4]) {
    const steps = entries
      .filter((entry) => entry.epochIndices[0] === index)
      .map((entry) => entry.step[0]);
    expect(steps).toContain("ancestral-fluvial-erosion");
    expect(steps).toContain("physical-epoch-history");
    expect(steps.some((name) => name.startsWith("magic"))).toBe(false);
  }
});
