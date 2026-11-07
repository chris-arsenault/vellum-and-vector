import { expect, it } from "vitest";
import { nativeWorkload } from "./nativeWorkload";

it("derives physical workload order and invocation flags from the default atlas composition", () => {
  const entries = nativeWorkload(),
    formation = entries.filter(({ path }) => path[0].startsWith("formation/")),
    epochs = entries.filter(({ epochIndices }) => epochIndices.length);
  expect(formation.length).toBeGreaterThan(0);
  expect(formation.every(({ invocation }) => invocation.parameters?.initial)).toBe(true);
  expect(formation.at(-1)!.step[0]).toBe("geothermal");
  const loadedSupport = epochs.find(
    ({ step, invocation }) => step[0] === "crustal-support" && invocation.parameters?.iceLoad
  );
  expect(loadedSupport?.invocation.parameters).toEqual(expect.objectContaining({ iceLoad: true }));
  expect(epochs.some(({ step }) => step[0] === "ancestral-fluvial-erosion")).toBe(true);
  expect(entries.every(({ step, invocation }) => invocation.process === `atlas.${step[0]}`)).toBe(
    true
  );
});
