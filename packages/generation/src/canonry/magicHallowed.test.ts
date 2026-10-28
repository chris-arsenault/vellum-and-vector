import { expect, it } from "vitest";
import { canonryMagicPresets, residentBand, type SocietyCommunity } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import type { MapProcessContext } from "../process";
import type { SocietyWorkspace } from "../societyGeography";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { initializeMagic } from "./magicState";
import { locateMagicSources } from "./magicSources";
import { propagateMagic } from "./magicPropagation";
import {
  magicCoastalFeedback,
  magicLivingFeedback,
  magicRockFeedback,
  retainMagicHistory,
} from "./magicFeedback";
import { advanceStocks } from "./magicStocks";
import { hallowedWrites } from "./magicHallowed";
import { nativeIndexAtSurface } from "./atlasWorkspace";

/** One inhabited seat of two thousand at the world's centre. */
function makeSeat(): SocietyCommunity {
  return {
    id: "seat",
    name: "Seat",
    position: { x: 0, y: 0, z: 0 },
    areaKm2: 100,
    groups: [
      { people: "p", culture: null, languages: [], religions: [], practices: [], count: 2000 },
    ],
    support: { farming: 0, grazing: 0, gathering: 0, fishing: 0, water: 1, capacity: 5000 },
    founded: "Settlement",
    status: "inhabited",
    protected: false,
    causes: [],
  };
}
/** A 200 km square of land at 10 km cells with one seat at its centre, kept for a long time. */
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
    samples: residentBand("int32", new Int32Array(state.surface.active.length)),
    grid: state.surface.coverage,
    fixed: [],
    inherited: false,
    sampling: { maximumSize: map.mesh.spacing, minimumSize: map.mesh.spacing, featureSamples: 2 },
  };
  map.Temperature.fill(300);
  map.WaterKindCodes.fill(0);
  map.IceThickness.fill(0);
  map.RockResistance.fill(500);
  map.FractureConductance.fill(1000);
  map.Moisture.fill(200);
  map.WindX.fill(1000);
  map.FlowTargets.fill(-1);
  initializeMagic(state);
  const fields = state.physical.magic!.fields,
    field = (id: string) => fields.find((f) => f.definition.id === id)!;
  // The seat's cell as the society recorder finds it from the seat's position.
  const centre = nativeIndexAtSurface(state, 0, 0),
    seat = makeSeat();
  state.society = {
    region: {
      areaId: "area",
      spaceId: "surface",
      communities: [seat],
      connections: [],
      history: [],
      works: [],
      events: [],
      magic: [],
    },
    owner: residentBand("int32", new Int32Array(0)),
    edges: [],
    river: residentBand("float64", new Float64Array(0)),
    coast: residentBand("float64", new Float64Array(0)),
    inherited: false,
    changed: new Set(),
    mediumChanged: new Set(),
  } as SocietyWorkspace;
  // Three hundred million person-years: a seat kept long past the full-source tenure.
  map.Tenure.set(centre, 300_000_000);
  const evaluate = (id: string) => {
    locateMagicSources(state, field(id), 1, 0);
    propagateMagic(state, field(id), 1, 1);
  };
  const ward = () => {
    evaluate("hallowed");
    magicLivingFeedback(state);
  };
  const distance = (i: number) =>
    Math.hypot(map.mesh.x(i) - map.mesh.x(centre), map.mesh.y(i) - map.mesh.y(centre));
  return { state, map, field, centre, seat, evaluate, ward, distance };
}
const context = { epochIndices: [0], recordCause() {} } as unknown as MapProcessContext;
const allCells = (map: ReturnType<typeof scenario>["map"]) =>
  Array.from({ length: map.mesh.count }, (_, i) => i);

it("wards a ring around a kept seat: other systems weaken inside and strengthen on the rim", () => {
  const s = scenario(),
    hallowed = s.field("hallowed"),
    fire = s.field("fire"),
    rim = s.state.physical!.magic!.wardRim;
  s.ward();
  expect(hallowed.intensity.get(s.centre)).toBe(1000);
  expect(s.map.Warding.get(s.centre)).toBe(1);
  const inside = allCells(s.map).filter((i) => s.map.Warding.get(i) > 0),
    far = allCells(s.map).filter(
      (i) => s.map.Warding.get(i) === 0 && !rim.get(i) && s.distance(i) < 90_000
    );
  expect(inside.every((i) => s.distance(i) < 40_000)).toBe(true);
  expect(inside.length).toBeGreaterThan(5);
  expect(Array.from(rim).filter(Boolean).length).toBeGreaterThan(0);
  // Fire everywhere at one strength: inside the ring it is scaled down, on the rim raised.
  fire.source.fill(300);
  propagateMagic(s.state, fire, 1, 1);
  expect(fire.intensity.get(s.centre)).toBe(0);
  expect(inside.every((i) => fire.intensity.get(i) <= 300)).toBe(true);
  const rimCells = allCells(s.map).filter((i) => rim.get(i));
  expect(rimCells.every((i) => fire.intensity.get(i) > 300)).toBe(true);
  expect(far.every((i) => fire.intensity.get(i) === 300)).toBe(true);
});

it("seals Fire's conduits at the ward and opens them when it lapses", () => {
  const s = scenario(),
    fire = s.field("fire"),
    west = allCells(s.map).find(
      (i) => s.map.mesh.x(i) < -85_000 && Math.abs(s.map.mesh.y(i)) < 5000
    )!;
  s.ward();
  fire.source.set(west, 1000);
  propagateMagic(s.state, fire, 1, 1);
  expect(fire.intensity.get(s.centre)).toBe(0);
  const edge = allCells(s.map).find(
    (i) => s.map.Warding.get(i) < 0.5 && s.map.Warding.get(i) > 0 && s.map.mesh.x(i) < 0
  )!;
  expect(fire.intensity.get(edge)).toBeGreaterThan(0);
  // The seat is abandoned and the ward gone: the conduit reaches the centre at once.
  s.map.Warding.fill(0);
  s.state.physical!.magic!.wardRim.fill(0);
  propagateMagic(s.state, fire, 1, 1);
  expect(fire.intensity.get(s.centre)).toBeGreaterThan(0);
});

it("pools brine before the ward, lands the storm on the rim and spills the held sediment below", () => {
  const s = scenario(),
    salt = s.field("salt"),
    rim = s.state.physical!.magic!.wardRim;
  s.ward();
  // A cell before the ward drains across it: its brine pools and crusts instead of seeping in.
  const neighbours = (i: number) =>
    Array.from({ length: s.map.mesh.degree(i) }, (_, e) => s.map.mesh.neighbor(i, e));
  const target = allCells(s.map).find(
    (i) =>
      s.map.Warding.get(i) >= 0.5 && neighbours(i).some((j) => j >= 0 && s.map.Warding.get(j) < 0.5)
  )!;
  const before = neighbours(target).find((j) => j >= 0 && s.map.Warding.get(j) < 0.5)!;
  s.map.FlowTargets.set(before, target);
  salt.stocks["death/brine"].set(before, 1000);
  advanceStocks(s.state, salt, 0);
  expect(salt.stocks["death/brine"].get(target)).toBe(0);
  expect(salt.stocks["death/bed"].get(before)).toBeGreaterThan(0);
  // Storm tracks inside land their energy on the rim; a channel leaving the ring cuts below.
  const beyond = allCells(s.map).find((i) => rim.get(i))!;
  s.map.StormTrack.set(s.centre, 800);
  s.map.FlowTargets.set(s.centre, beyond);
  const resistance = s.map.RockResistance.get(beyond);
  hallowedWrites(s.state);
  expect(s.map.StormForcing.get(beyond)).toBeGreaterThan(0);
  expect(s.map.StormForcing.get(s.centre)).toBe(0);
  expect(s.map.RockResistance.get(beyond)).toBe(resistance - 200 * s.map.Warding.get(s.centre));
  // Inside, the rock holds through the system's own resistance.
  magicRockFeedback(s.state);
  expect(s.map.RockResistance.get(s.centre)).toBe(800);
});

/** The sea lies north of 50 km with its current running east, and Pressure presses the shore. */
function pressedShore(s: ReturnType<typeof scenario>) {
  const pressure = s.field("pressure");
  for (let i = 0; i < s.map.mesh.count; i++)
    if (s.map.mesh.y(i) > 50_000) {
      s.map.WaterKindCodes.set(i, 1);
      s.map.OceanCurrentX.set(i, 1000);
      s.map.OceanCurrentStrength.set(i, 500);
      pressure.intensity.set(i, 800);
    }
  const coastal = (i: number) => {
    if (s.map.WaterKindCodes.get(i) !== 0) return false;
    for (let edge = 0; edge < s.map.mesh.degree(i); edge++) {
      const j = s.map.mesh.neighbor(i, edge);
      if (j >= 0 && s.map.WaterKindCodes.get(j) === 1) return true;
    }
    return false;
  };
  return allCells(s.map).filter(coastal);
}
const sum = (values: Iterable<number>) => Array.from(values).reduce((a, b) => a + b, 0);

it("moves a warded shore's forcing to the shore downdrift of it", () => {
  const s = scenario(),
    shore = pressedShore(s),
    warded = shore.find((i) => Math.abs(s.map.mesh.x(i)) < 5000)!;
  const plain = scenario();
  pressedShore(plain);
  magicCoastalFeedback(plain.state);
  s.map.Warding.set(warded, 1);
  magicCoastalFeedback(s.state);
  expect(plain.map.ExternalCoastalForcing.get(warded)).toBeGreaterThan(0);
  expect(s.map.ExternalCoastalForcing.get(warded)).toBe(0);
  // What the ward held is not destroyed: it lands on land east of it, along the current.
  const east = shore.filter((i) => s.map.mesh.x(i) > s.map.mesh.x(warded));
  expect(
    east.some((i) => s.map.ExternalCoastalForcing.get(i) > plain.map.ExternalCoastalForcing.get(i))
  ).toBe(true);
  // The receiving shore saturates at full forcing, so what lands is at least part of what left.
  expect(sum(s.map.ExternalCoastalForcing)).toBeGreaterThan(
    sum(plain.map.ExternalCoastalForcing) - plain.map.ExternalCoastalForcing.get(warded)
  );
});

it("breaks the line where a Fire conduit opens, and Aurora's held charge reinforces it", () => {
  const s = scenario(),
    hallowed = s.field("hallowed"),
    fire = s.field("fire"),
    aurora = s.field("aurora");
  s.ward();
  const ringCell = allCells(s.map).find(
    (i) => s.map.Warding.get(i) > 0.3 && s.map.Warding.get(i) < 0.6
  )!;
  const plain = hallowed.intensity.get(ringCell);
  aurora.stored.set(ringCell, 400);
  s.evaluate("hallowed");
  // Three tenths of the held charge, in proportion to the ward already there.
  expect(Math.abs(hallowed.intensity.get(ringCell) - plain * 1.12)).toBeLessThanOrEqual(1);
  fire.source.set(s.centre, 500);
  s.evaluate("hallowed");
  expect(hallowed.intensity.get(s.centre)).toBe(0);
});

it("fades when the seat is abandoned, by the history's retention", () => {
  const s = scenario(),
    hallowed = s.field("hallowed");
  s.ward();
  retainMagicHistory(s.state, context);
  expect(hallowed.stored.get(s.centre)).toBe(500);
  s.seat.status = "abandoned";
  const held: number[] = [];
  for (let epoch = 0; epoch < 3; epoch++) {
    s.evaluate("hallowed");
    held.push(hallowed.intensity.get(s.centre));
    retainMagicHistory(s.state, context);
  }
  expect(held[0]).toBe(500);
  expect(held[1]).toBeLessThan(held[0]);
  expect(held[2]).toBeLessThan(held[1]);
  expect(held[2]).toBeGreaterThan(0);
});

it("makes no seat of a young town: tenure below the source floor wards nothing", () => {
  const s = scenario(),
    hallowed = s.field("hallowed");
  // Five million person-years: a town, not a seat kept for ages.
  s.map.Tenure.set(s.centre, 5_000_000);
  s.ward();
  expect(hallowed.source.get(s.centre)).toBe(0);
  expect(hallowed.located).toHaveLength(0);
  expect(Array.from(s.map.Warding).some(Boolean)).toBe(false);
});

it("changes nothing when Hallowed is disabled", () => {
  const s = scenario(),
    hallowed = s.field("hallowed"),
    fire = s.field("fire");
  hallowed.definition.enabled = false;
  s.ward();
  expect(Array.from(s.map.Warding).some(Boolean)).toBe(false);
  fire.source.fill(300);
  propagateMagic(s.state, fire, 1, 1);
  expect(Array.from(fire.intensity).every((v) => v === 300)).toBe(true);
});
