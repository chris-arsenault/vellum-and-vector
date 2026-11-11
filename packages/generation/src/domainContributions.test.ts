import { expect, it } from "vitest";
import { localMagicContribution } from "./domainContributions";

it("refreshes located regional heat before local climate without world temperature or elapsed storage", () => {
  const context = {
    execution: "regional" as const,
    source: { world: { magic: [{ systemId: null }] } },
    process: "refinement.climate",
  };
  const calls = localMagicContribution("before.model-pass", context);
  expect(calls.map((call) => call.kind === "process" && call.process)).toEqual([
    "atlas.forcing",
    "refinement.climate",
    "atlas.project-forcing",
    "magic.thermal",
    "magic.material",
    "atlas.forcing",
  ]);
  const material = localMagicContribution("epoch.material-forcing", context);
  expect(
    material.find((call) => call.kind === "process" && call.process === "magic.material")
  ).toMatchObject({ parameters: { react: true } });
  expect(
    calls.find((call) => call.kind === "process" && call.process === "magic.material")
  ).toMatchObject({ parameters: {} });
  expect(calls[0]).toMatchObject({ parameters: { includeStandalone: false } });
  expect(localMagicContribution("epoch.storage", context)).toEqual([]);
  expect(localMagicContribution("after.model-pass", context)).toEqual([]);
  expect(
    localMagicContribution("before.model-pass", {
      ...context,
      process: "atlas.atmospheric-climate",
    })
  ).toEqual([]);
});
