import { expect, it } from "vitest";
import { canonryMagicPresets } from "@atlas/domain";
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
    samples: new Int32Array(state.surface.active.length),
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
const neighbour = (map: ReturnType<typeof scenario>["map"], i: number, not: number) => {
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const j = map.mesh.neighbors[i * map.mesh.stride + edge];
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
  const a = 0,
    b = neighbour(map, a, -1),
    c = neighbour(map, b, a),
    d = neighbour(map, c, b);
  for (const i of [a, b, c]) map.IceThickness[i] = 300;
  map.IceFlowTargets[a] = b;
  map.IceFlowTargets[b] = c;
  map.IceFlowTargets[c] = d;
  ice[a] = 1000;
  advanceStocks(state, aurora, 0);
  expect(ice[a]).toBeCloseTo(200, 6);
  expect(ice[b]).toBeCloseTo(800, 6);
  expect(map.IceCharge[b]).toBeGreaterThan(0);
  expect(map.IceCharge[d]).toBe(0);
  advanceStocks(state, aurora, 1);
  advanceStocks(state, aurora, 2);
  // The ice ends on bare land at d: what it carried there lies in the moraine.
  expect(moraine[d]).toBeGreaterThan(0);
  expect(ice[d]).toBe(0);
  // Ice that flows into the sea calves its charge onto the shelf.
  const f = neighbour(map, d, c),
    sea = neighbour(map, f, d);
  map.IceThickness[f] = 300;
  map.WaterKindCodes[sea] = 1;
  map.IceFlowTargets[f] = sea;
  ice[f] = 500;
  advanceStocks(state, aurora, 3);
  expect(shelf[sea]).toBeCloseTo(400, 6);
  // Meltwater takes its share of the reservoir out of the budget.
  const lost = aurora.lost;
  map.GlacialMeltwater[b] = 1000;
  const held = ice[b];
  advanceStocks(state, aurora, 4);
  expect(aurora.lost - lost).toBeGreaterThanOrEqual(held * 0.2 - 1e-6);
});

it("keeps a deglaciated valley still through its relict charge, at the relict strength", () => {
  const { state, map, aurora } = scenario();
  aurora.stored.fill(600);
  aurora.intensity.fill(600);
  magicLivingFeedback(state);
  expect(map.Stillness[0]).toBeGreaterThan(0);
  const relict = map.Stillness[0];
  map.IceThickness.fill(300);
  magicLivingFeedback(state);
  expect(map.Stillness[0]).toBeGreaterThan(relict);
  map.IceThickness.fill(0);
  aurora.definition.parameters.relictStrength = 0;
  magicLivingFeedback(state);
  expect(map.Stillness[0]).toBe(0);
});

it("cuts deeper under charged sliding ice and leaves cold-based ice alone", () => {
  const cut = (charge: number, flux: number) => {
    const { map } = scenario(),
      profile = atlasPhysicalProfile();
    map.IceThickness.fill(400);
    map.GroundedIce.fill(1);
    map.IceFlux.fill(flux);
    map.IceCharge.fill(charge);
    map.BedrockElevation.fill(units(1000));
    map.SedimentThickness.fill(0);
    const before = map.BedrockElevation[0];
    glacialErosion(map, physicalContext(1, 0, profile));
    return before - map.BedrockElevation[0];
  };
  const sliding = 2 * atlasPhysicalProfile().GlacierFluxThreshold;
  expect(cut(1, sliding)).toBeGreaterThan(cut(0, sliding));
  expect(cut(0, sliding)).toBeGreaterThan(0);
  expect(cut(1, 0)).toBe(0);
});

it("settles thawing ground within its bound and leaves iced ground alone", () => {
  const { state, map, aurora } = scenario(),
    limit = aurora.definition.parameters.thawSubsidenceLimit,
    iced = 5;
  map.BedrockElevation.fill(units(500));
  map.SedimentThickness.fill(0);
  map.IceThickness[iced] = 100;
  const before = map.BedrockElevation.slice();
  for (let epoch = 0; epoch < 12; epoch++) {
    aurora.stored.fill(800);
    aurora.intensity.fill(0);
    retainMagicHistory(state, context);
  }
  expect(map.BedrockElevation[0]).toBeLessThan(before[0]);
  expect(before[0] - map.BedrockElevation[0]).toBeCloseTo(units(limit), -1);
  expect(aurora.subsided[0]).toBeCloseTo(limit, 6);
  expect(map.BedrockElevation[iced]).toBe(before[iced]);
});

it("releases the preserved matter at the melt line when stillness falls", () => {
  const { map } = scenario();
  map.EcologyStillness.fill(0.8);
  map.Stillness.fill(0);
  map.MineralNutrients.fill(0);
  map.SoilCarbon.fill(10);
  evolveSoils(map, 100, () => neutralEcology);
  expect(map.MineralNutrients[0]).toBeGreaterThan(0);
  expect(map.SoilCarbon[0]).toBeLessThan(10);
});
