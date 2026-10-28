import { expect, it } from "vitest";
import { canonryMagicPresets } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { initializeMagic } from "./magicState";
import { magicOceanFeedback } from "./magicFeedback";
import { marchAirColumns } from "./airColumn";
import { alignedNeighbor } from "./atmosphere";
import { stormWrites } from "./magicWeather";
import { units } from "./math";

/** Sea to the west, a coast at x = 0, a ridge at 30 to 50 km, a plain in its lee; wind from the west. */
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
  map.EffectiveSeaLevel = 0;
  map.Temperature.fill(450);
  map.WindX.fill(1000);
  map.WindY.fill(0);
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x(i);
    map.WaterKindCodes.set(i, x < 0 ? 1 : 0);
    map.WaterDepths.set(i, x < 0 ? units(2000) : 0);
    map.Elevation.set(
      i,
      x < 0 ? units(-2000) : x > 30_000 && x < 50_000 ? units(1500) : units(100)
    );
    map.UpwindTargets.set(i, alignedNeighbor(map, i, -1, 0));
  }
  initializeMagic(state);
  return { state, map, pressure: state.physical.magic!.fields[2] };
}
const band = (map: ReturnType<typeof scenario>["map"], low: number, high: number) =>
  Array.from({ length: map.mesh.count }, (_, i) => i).filter(
    (i) => map.mesh.x(i) >= low && map.mesh.x(i) < high
  );
const total = (values: { get(i: number): number }, cells: number[]) =>
  cells.reduce((sum, i) => sum + values.get(i), 0);
const rainout = () => 0.6;

/** A warm wake along the coast with a sharp edge: the storm's birthplace. */
function wake(
  state: ReturnType<typeof scenario>["state"],
  map: ReturnType<typeof scenario>["map"]
) {
  const pressure = state.physical!.magic!.fields[2];
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 1 || map.mesh.x(i) < -30_000) continue;
    pressure.intensity.set(i, 600);
    pressure.wake.set(i, 1);
    map.SeaSurfaceAnomaly.set(i, 60);
  }
  magicOceanFeedback(state);
}

it("raises a storm on a sharp warm front at sea and nowhere the sea is flat", () => {
  const { state, map } = scenario();
  wake(state, map);
  expect(Array.from(map.StormForcing).some((value) => value > 0)).toBe(true);
  // The front is the wake's edge; the flat interior of the wake and the open sea raise none.
  for (let i = 0; i < map.mesh.count; i++)
    if (map.StormForcing.get(i) > 0) expect(map.WaterKindCodes.get(i)).toBe(1);
  const flat = band(map, -100_000, -60_000);
  expect(total(map.StormForcing, flat)).toBe(0);
  // Fire heat in the air above the front feeds the storm.
  const fed = scenario();
  fed.map.ExternalHeatForcing.fill(200);
  wake(fed.state, fed.map);
  expect(total(fed.map.StormForcing, band(fed.map, -30_000, 0))).toBeGreaterThan(
    total(map.StormForcing, band(map, -30_000, 0))
  );
});

it("wets the windward slope and dries the lee more than the same coast without the storm", () => {
  const { state, map } = scenario();
  wake(state, map);
  const context = physicalContext(1, 0, atlasPhysicalProfile());
  const stormy = marchAirColumns(map, context, rainout);
  const forcing = map.coverage.copyBand(map.StormForcing);
  map.StormForcing.fill(0);
  const calm = marchAirColumns(map, context, rainout);
  map.StormForcing.copyFrom(forcing);
  const windward = band(map, 0, 50_000),
    lee = band(map, 60_000, 100_000);
  const windwardGain = total(stormy.precipitation, windward) - total(calm.precipitation, windward),
    leeGain = total(stormy.precipitation, lee) - total(calm.precipitation, lee);
  expect(windwardGain).toBeGreaterThan(0);
  expect(windwardGain).toBeGreaterThan(leeGain);
  // The track is the pulse the columns carry; it fades inland.
  expect(total(stormy.storm, band(map, 0, 20_000))).toBeGreaterThan(
    total(stormy.storm, band(map, 80_000, 100_000))
  );
});

it("pins the front where Aurora stills the air, dropping the rain there and starving the lee", () => {
  const { state, map } = scenario();
  wake(state, map);
  const context = physicalContext(1, 0, atlasPhysicalProfile());
  const free = marchAirColumns(map, context, rainout);
  for (const i of band(map, 0, 20_000)) map.Stillness.set(i, 1);
  const pinned = marchAirColumns(map, context, rainout);
  const beyond = band(map, 30_000, 100_000);
  expect(total(pinned.storm, beyond)).toBeLessThan(total(free.storm, beyond));
  expect(total(pinned.precipitation, beyond)).toBeLessThan(total(free.precipitation, beyond));
});

it("scours soil on steep ground under the track and drives bare sand downwind", () => {
  const { state, map } = scenario();
  const land = band(map, 0, 100_000);
  for (const i of land) {
    map.StormTrack.set(i, 1000);
    map.SoilDepth.set(i, 2);
    map.SoilWater.set(i, 50);
    map.SedimentThickness.set(i, units(3));
    map.GrassCover.set(i, 0.5);
    map.Slope.set(i, map.mesh.x(i) > 30_000 && map.mesh.x(i) < 50_000 ? 0.1 : 0);
  }
  const steep = land.find((i) => map.Slope.get(i) > 0)!,
    flat = land.find((i) => map.Slope.get(i) === 0 && map.mesh.x(i) < 20_000)!,
    downwind = alignedNeighbor(map, flat, 1, 0);
  // One bare cell among covered ones: its sand goes to the covered neighbour downwind.
  map.GrassCover.set(flat, 0);
  const sediment = map.SedimentThickness.get(downwind);
  stormWrites(state);
  expect(map.SoilDepth.get(steep)).toBeLessThan(2);
  expect(map.SoilDepth.get(flat)).toBe(2);
  // Bare ground loses sand to its downwind neighbour.
  expect(map.SedimentThickness.get(flat)).toBeLessThan(units(3));
  expect(map.SedimentThickness.get(downwind)).toBeGreaterThan(sediment);
  // Covered ground keeps its sand.
  const held = scenario();
  for (const i of band(held.map, 0, 100_000)) {
    held.map.StormTrack.set(i, 1000);
    held.map.SedimentThickness.set(i, units(3));
    held.map.GrassCover.set(i, 0.5);
  }
  stormWrites(held.state);
  expect(held.map.SedimentThickness.get(flat)).toBe(units(3));
});
