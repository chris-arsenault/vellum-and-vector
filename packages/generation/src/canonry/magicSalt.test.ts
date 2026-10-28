import { expect, it } from "vitest";
import { canonryMagicPresets } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { initializeMagic, reservoirAmount } from "./magicState";
import { locateMagicSources } from "./magicSources";
import { propagateMagic } from "./magicPropagation";
import { magicLivingFeedback } from "./magicFeedback";
import { advanceStocks } from "./magicStocks";
import { rememberLakes } from "./magicSaltSources";
import { saltWrites } from "./magicSalt";
import { coverSystems } from "./magicFeatures";
import { groupSuitability, plantGroups } from "./ecologyGroups";
import { neutralEcology } from "./ecologyEnvironment";
import { alignedNeighbor } from "./atmosphere";
import { units } from "./math";

/** A 200 km square of dry land at 10 km cells; the wind blows east, the drainage runs east. */
function scenario() {
  const state = landscape(),
    map = createField(
      createAdaptiveWorldMesh(
        [-100_000, -100_000, 100_000, 100_000],
        { maximumSize: 10_000, minimumSize: 10_000, refine: () => true },
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
  map.Temperature.fill(300);
  map.WaterKindCodes.fill(0);
  map.IceThickness.fill(0);
  map.RockResistance.fill(500);
  map.SoilDepth.fill(0.5);
  map.Moisture.fill(200);
  map.WindX.fill(1000);
  map.WindY.fill(0);
  map.FlowTargets.fill(-1);
  initializeMagic(state);
  const salt = state.physical.magic!.fields.find((f) => f.definition.id === "salt")!;
  return { state, map, salt };
}
const cells = (map: ReturnType<typeof scenario>["map"], test: (x: number, y: number) => boolean) =>
  Array.from({ length: map.mesh.count }, (_, i) => i).filter((i) =>
    test(map.mesh.x(i), map.mesh.y(i))
  );
const centre = (map: ReturnType<typeof scenario>["map"]) =>
  cells(map, (x, y) => Math.abs(x) < 5000 && Math.abs(y) < 5000)[0];
/** The neighbour the wind carries to: the cell downwind of `i`, as the carriers find it. */
const east = (map: ReturnType<typeof scenario>["map"], i: number) => alignedNeighbor(map, i, 1, 0);
const evaluate = (s: ReturnType<typeof scenario>) => {
  locateMagicSources(s.state, s.salt, 1, 0);
  propagateMagic(s.state, s.salt, 1, 1);
  magicLivingFeedback(s.state);
};

it("turns the dead the ground records into brine, consumes the record, and salts the ground", () => {
  const s = scenario(),
    i = centre(s.map),
    area = s.map.mesh.area(i);
  // A city's fall: twenty thousand dead on one cell.
  s.map.MassDeath.set(i, 20_000);
  evaluate(s);
  expect(s.map.MassDeath.get(i)).toBe(0);
  expect(s.salt.stocks["death/brine"].get(i)).toBe(20_000 * 5_000_000);
  expect(s.salt.source.get(i)).toBe(1000);
  expect(s.salt.intensity.get(i)).toBe(1000);
  expect(s.map.Salting.get(i)).toBe(1);
  expect(s.map.Salting.get(east(s.map, i))).toBe(0);
  // Evaluating again makes nothing more: the dead were used.
  const before = s.salt.stocks["death/brine"].get(i);
  evaluate(s);
  expect(s.salt.stocks["death/brine"].get(i)).toBe(before);
  expect(reservoirAmount(s.salt, "brine", i) / area).toBeGreaterThan(400);
});

it("names a killing ground by the brine in it, whatever the field holds between evaluations", () => {
  const s = scenario(),
    i = centre(s.map),
    area = s.map.mesh.area(i);
  // Two thousand dead on the cell, a few dozen on the next: only the first is a killing.
  s.map.MassDeath.set(i, 2000);
  s.map.MassDeath.set(east(s.map, i), 30);
  evaluate(s);
  const brine = s.salt.stocks["death/brine"].get(i) / area;
  expect(brine).toBeGreaterThan(20);
  // Between evaluations Salt lapses to its stored fifth; the ground is still salted.
  s.salt.intensity.fill(0);
  coverSystems(s.state, 1);
  expect(s.salt.features.ground.get(i)).toBe(1);
  expect(s.salt.coverage.ground.get(i)).toBeCloseTo(Math.min(1, (brine - 20) / 380), 6);
  expect(s.salt.features.ground.get(east(s.map, i))).toBe(0);
});

it("seeps brine downslope, keeps it on dry ground, flushes it on wet ground and crusts it at a pit", () => {
  const s = scenario(),
    i = centre(s.map),
    j = east(s.map, i);
  s.map.FlowTargets.set(i, j);
  s.salt.stocks["death/brine"].set(i, 1000);
  advanceStocks(s.state, s.salt, 0);
  const seeped = s.salt.stocks["death/brine"].get(j);
  expect(seeped).toBeGreaterThan(0);
  // The pit crusts half of what reaches it to bed each epoch; nothing leaves a dry pit.
  expect(s.salt.stocks["death/bed"].get(j)).toBe(0);
  advanceStocks(s.state, s.salt, 0);
  expect(s.salt.stocks["death/bed"].get(j)).toBeGreaterThan(0);
  const dry = s.salt.lost;
  // The same brine on wet, oxygenated ground is flushed away.
  const wet = scenario();
  wet.map.Moisture.fill(1000);
  wet.salt.stocks["death/brine"].set(centre(wet.map), 1000);
  advanceStocks(wet.state, wet.salt, 0);
  expect(wet.salt.lost).toBeGreaterThan(dry);
  // Peat keeps the brine the moisture would flush.
  const peat = scenario();
  peat.map.Moisture.fill(1000);
  peat.map.PeatCarbon.fill(40);
  peat.salt.stocks["death/brine"].set(centre(peat.map), 1000);
  advanceStocks(peat.state, peat.salt, 0);
  expect(peat.salt.lost).toBeLessThan(wet.salt.lost);
});

it("lifts an exposed bed downwind as dust that settles to bed a cell on", () => {
  const s = scenario(),
    i = centre(s.map),
    j = east(s.map, i);
  s.salt.stocks["death/bed"].set(i, 1000);
  advanceStocks(s.state, s.salt, 0);
  // The wind lifts 15% of the bed; half of it settles to bed one cell on in the same epoch
  // and the rest blows another cell before the next epoch's settling.
  expect(s.salt.stocks["death/bed"].get(i)).toBe(850);
  expect(s.salt.stocks["death/bed"].get(j)).toBe(75);
  expect(s.salt.stocks["death/dust"].get(j)).toBe(0);
  expect(s.salt.stocks["death/dust"].get(east(s.map, j))).toBe(75);
  advanceStocks(s.state, s.salt, 0);
  expect(s.salt.stocks["death/bed"].get(east(s.map, j))).toBeGreaterThan(0);
  // Cover holds the bed down.
  const wooded = scenario();
  wooded.map.TreeCover.fill(1);
  wooded.salt.stocks["death/bed"].set(centre(wooded.map), 1000);
  advanceStocks(wooded.state, wooded.salt, 0);
  expect(wooded.salt.stocks["death/bed"].get(centre(wooded.map))).toBe(1000);
});

it("leaves the bed of a lake that died in a basin, by the depth it held", () => {
  const s = scenario(),
    i = centre(s.map),
    area = s.map.mesh.area(i);
  s.map.WaterKindCodes.set(i, 2);
  s.map.WaterDepths.set(i, units(10));
  rememberLakes(s.map);
  expect(s.map.LakeMemory.get(i)).toBe(10);
  // The lake is still water: no bed yet.
  evaluate(s);
  expect(s.salt.stocks["dead-lake/bed"].get(i)).toBe(0);
  // It dries in a basin that still lies below its spill: the bed is left.
  s.map.WaterKindCodes.set(i, 0);
  s.map.WaterDepths.set(i, 0);
  s.map.DrainageElevations.set(i, s.map.Elevation.get(i) + units(5));
  evaluate(s);
  expect(s.salt.stocks["dead-lake/bed"].get(i)).toBe(10 * area * 40);
  expect(s.map.LakeMemory.get(i)).toBe(0);
  expect(s.salt.intensity.get(i)).toBe(1000);
});

it("fuses a deep bed to glass, dries the air over salted ground, thins the living and turns grazers away", () => {
  const s = scenario(),
    i = centre(s.map),
    area = s.map.mesh.area(i);
  s.salt.stocks["dead-lake/bed"].set(i, 1000 * area);
  s.map.Moisture.fill(600);
  evaluate(s);
  saltWrites(s.state);
  expect(s.map.RockResistance.get(i)).toBe(800);
  expect(s.map.SoilDepth.get(i)).toBe(0);
  expect(s.map.Moisture.get(i)).toBe(300);
  expect(s.map.Moisture.get(east(s.map, i))).toBe(600);
  const salted = { ...neutralEcology, salting: 1 },
    grass = plantGroups.find((g) => g.id === "grass")!;
  const open = scenario().map;
  open.Temperature.fill(450);
  open.Rainfall.fill(800);
  expect(groupSuitability(open, grass, centre(open), salted)).toBeLessThanOrEqual(
    groupSuitability(open, grass, centre(open), neutralEcology)
  );
});

it("burns Salt clean under Fire and fuses what it burns", () => {
  const s = scenario(),
    i = centre(s.map),
    fire = s.state.physical!.magic!.fields.find((f) => f.definition.id === "fire")!;
  s.salt.stocks["death/bed"].set(i, 100 * s.map.mesh.area(i));
  fire.intensity.set(i, 1000);
  evaluate(s);
  const before = s.salt.lost;
  saltWrites(s.state);
  expect(s.salt.stocks["death/bed"].get(i)).toBeCloseTo(20 * s.map.mesh.area(i), 3);
  expect(s.salt.lost).toBeGreaterThan(before);
  expect(s.map.RockResistance.get(i)).toBeGreaterThan(500);
});

it("domes a buried bed under strain within its bound and seeps brine to the ring", () => {
  const s = scenario(),
    i = centre(s.map),
    j = east(s.map, i),
    area = s.map.mesh.area(i);
  s.map.SedimentThickness.set(i, units(50));
  s.map.TectonicStrain.set(i, 800);
  s.salt.stocks["dead-lake/bed"].set(i, 1000 * area);
  const ground = s.map.BedrockElevation.get(i);
  for (let epoch = 0; epoch < 40; epoch++) advanceStocks(s.state, s.salt, epoch);
  expect(s.salt.domed.get(i)).toBeCloseTo(60, 6);
  expect(s.map.BedrockElevation.get(i)).toBeCloseTo(ground + units(60), 3);
  expect(s.salt.stocks["dead-lake/brine"].get(j)).toBeGreaterThan(0);
  // Buried bed without strain stays where it is and blows nowhere.
  const still = scenario();
  still.map.SedimentThickness.set(centre(still.map), units(50));
  still.salt.stocks["dead-lake/bed"].set(centre(still.map), 1000 * area);
  advanceStocks(still.state, still.salt, 0);
  expect(still.salt.stocks["dead-lake/bed"].get(centre(still.map))).toBe(1000 * area);
  expect(still.salt.domed.get(centre(still.map))).toBe(0);
});

it("leaves nothing when Salt is disabled", () => {
  const s = scenario(),
    i = centre(s.map);
  s.salt.definition.enabled = false;
  s.map.MassDeath.set(i, 20_000);
  evaluate(s);
  expect(s.salt.intensity.get(i)).toBe(0);
  expect(s.map.Salting.get(i)).toBe(0);
});
