import { expect, it } from "vitest";
import { canonryMagicPresets, residentBand } from "@atlas/domain";
import type { MapProcessContext } from "../process";
import { landscape } from "../mapFixtures";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { initializeMagic } from "./magicState";
import { magicLivingFeedback, retainMagicHistory } from "./magicFeedback";
import { advanceStocks } from "./magicStocks";
import { glacialErosion } from "./glacialEvolution";
import { evolveSoils } from "./ecologySoils";
import { neutralEcology } from "./ecologyEnvironment";
import { units } from "./math";

function scenario() {
  const state = landscape(),
    map = createField(
      createAdaptiveWorldMesh(
        [-100_000, -100_000, 100_000, 100_000],
        { maximumSize: 25_000, minimumSize: 12_500, refine: () => true },
        0
      )
    );
  state.domain.world.magicSystems = canonryMagicPresets();
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: residentBand("int32", new Int32Array(state.surface.active.length)),
    grid: state.surface.coverage,
    fixed: [],
    inherited: false,
    sampling: { maximumSize: map.mesh.spacing, minimumSize: map.mesh.spacing, featureSamples: 2 },
  };
  map.Temperature.fill(280);
  map.WaterKindCodes.fill(0);
  map.IceThickness.fill(0);
  map.IceFlowTargets.fill(-1);
  initializeMagic(state);
  return { state, map, aurora: state.physical.magic!.fields[1] };
}
/** The first content cell: the cell the whole-field tests read. */
const first = (map: ReturnType<typeof scenario>["map"]) => {
  for (let i = 0; i < map.mesh.count; i++) if (map.mesh.membership(i) === 1) return i;
  throw new Error("no content cell");
};
const neighbour = (map: ReturnType<typeof scenario>["map"], i: number, not: number) => {
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j >= 0 && j !== not) return j;
  }
  throw new Error("no neighbour");
};
const context = { epochIndices: [0], recordCause() {} } as unknown as MapProcessContext;

it("carries charge with the ice, dumps it at the terminus and on the shelf, and loses some to meltwater", () => {
  const { state, map, aurora } = scenario(),
    ice = aurora.stocks["field/ice"],
    moraine = aurora.stocks["field/moraine"],
    shelf = aurora.stocks["field/shelf"];
  const a = first(map),
    b = neighbour(map, a, -1),
    c = neighbour(map, b, a),
    d = neighbour(map, c, b);
  for (const i of [a, b, c]) map.IceThickness.set(i, 300);
  map.IceFlowTargets.set(a, b);
  map.IceFlowTargets.set(b, c);
  map.IceFlowTargets.set(c, d);
  ice.set(a, 1000);
  advanceStocks(state, aurora, 0);
  expect(ice.get(a)).toBeCloseTo(200, 6);
  expect(ice.get(b)).toBeCloseTo(800, 6);
  expect(map.IceCharge.get(b)).toBeGreaterThan(0);
  expect(map.IceCharge.get(d)).toBe(0);
  advanceStocks(state, aurora, 1);
  advanceStocks(state, aurora, 2);
  // The ice ends on bare land at d: what it carried there lies in the moraine.
  expect(moraine.get(d)).toBeGreaterThan(0);
  expect(ice.get(d)).toBe(0);
  // Ice that flows into the sea calves its charge onto the shelf.
  const f = neighbour(map, d, c),
    sea = neighbour(map, f, d);
  map.IceThickness.set(f, 300);
  map.WaterKindCodes.set(sea, 1);
  map.IceFlowTargets.set(f, sea);
  ice.set(f, 500);
  advanceStocks(state, aurora, 3);
  expect(shelf.get(sea)).toBeCloseTo(400, 6);
  // Meltwater takes its share of the reservoir out of the budget.
  const lost = aurora.lost;
  map.GlacialMeltwater.set(b, 1000);
  const held = ice.get(b);
  advanceStocks(state, aurora, 4);
  expect(aurora.lost - lost).toBeGreaterThanOrEqual(held * 0.2 - 1e-6);
});

it("keeps a deglaciated valley still through its relict charge, at the relict strength", () => {
  const { state, map, aurora } = scenario(),
    cell = first(map);
  aurora.stored.fill(600);
  aurora.intensity.fill(600);
  magicLivingFeedback(state);
  expect(map.Stillness.get(cell)).toBeGreaterThan(0);
  const relict = map.Stillness.get(cell);
  map.IceThickness.fill(300);
  magicLivingFeedback(state);
  expect(map.Stillness.get(cell)).toBeGreaterThan(relict);
  map.IceThickness.fill(0);
  aurora.definition.parameters.relictStrength = 0;
  magicLivingFeedback(state);
  expect(map.Stillness.get(cell)).toBe(0);
});

it("cuts deeper under charged sliding ice and leaves cold-based ice alone", () => {
  const cut = (charge: number, flux: number) => {
    const { map } = scenario(),
      profile = atlasPhysicalProfile(),
      cell = first(map);
    map.IceThickness.fill(400);
    map.GroundedIce.fill(1);
    map.IceFlux.fill(flux);
    map.IceCharge.fill(charge);
    map.BedrockElevation.fill(units(1000));
    map.SedimentThickness.fill(0);
    const before = map.BedrockElevation.get(cell);
    glacialErosion(map, physicalContext(1, 0, profile));
    return before - map.BedrockElevation.get(cell);
  };
  const sliding = 2 * atlasPhysicalProfile().GlacierFluxThreshold;
  expect(cut(1, sliding)).toBeGreaterThan(cut(0, sliding));
  expect(cut(0, sliding)).toBeGreaterThan(0);
  expect(cut(1, 0)).toBe(0);
});

it("settles thawing ground within its bound and leaves iced ground alone", () => {
  const { state, map, aurora } = scenario(),
    limit = aurora.definition.parameters.thawSubsidenceLimit,
    cell = first(map);
  let iced = -1;
  for (let i = cell + 1; i < map.mesh.count && iced < 0; i++)
    if (map.mesh.membership(i) === 1) iced = i;
  map.BedrockElevation.fill(units(500));
  map.SedimentThickness.fill(0);
  map.IceThickness.set(iced, 100);
  const before = Array.from(map.BedrockElevation);
  for (let epoch = 0; epoch < 12; epoch++) {
    aurora.stored.fill(800);
    aurora.intensity.fill(0);
    retainMagicHistory(state, context);
  }
  expect(map.BedrockElevation.get(cell)).toBeLessThan(before[cell]);
  expect(before[cell] - map.BedrockElevation.get(cell)).toBeCloseTo(units(limit), -1);
  expect(aurora.subsided.get(cell)).toBeCloseTo(limit, 6);
  expect(map.BedrockElevation.get(iced)).toBe(before[iced]);
});

it("releases the preserved matter at the melt line when stillness falls", () => {
  const { map } = scenario(),
    cell = first(map);
  map.EcologyStillness.fill(0.8);
  map.Stillness.fill(0);
  map.MineralNutrients.fill(0);
  map.SoilCarbon.fill(10);
  evolveSoils(map, 100, () => neutralEcology);
  expect(map.MineralNutrients.get(cell)).toBeGreaterThan(0);
  expect(map.SoilCarbon.get(cell)).toBeLessThan(10);
});
