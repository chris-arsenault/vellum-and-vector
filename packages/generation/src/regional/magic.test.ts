import { expect, it } from "vitest";
import { enableMagic, regionalFixture } from "./fixture";
import { cellAt, isContent } from "./lattice";
import { respondMagic } from "./magic/index";
import type { RegionalState } from "./state";

type Supplied = Record<string, [string, (x: number, y: number) => number]>;
/** A flat supplied country with the given captured magic channels and the named systems enabled. */
function magicCountry(ids: string[], supplied: Supplied, height = () => 100) {
  const f = regionalFixture(height, 20000, 1, { fracture: ["ratio", () => 0.2], ...supplied });
  f.state.regional.input.domains = ["physical", "magic"];
  const systems = enableMagic(f.state, ids);
  return {
    ...f,
    map: f.state.physical.map,
    systems,
    field: (id: string) =>
      f.state.physical.magic!.fields.find((field) => field.definition.id === id)!,
  };
}
const content = (state: RegionalState) => {
  const mesh = state.physical.map.mesh,
    cells: number[] = [];
  for (let i = 0; i < mesh.count; i++) if (isContent(mesh, i)) cells.push(i);
  return cells;
};
const nearCore = (x: number, y: number) =>
  Math.abs(x - 20000) <= 2500 && Math.abs(y - 10000) <= 2500;

it("propagates a captured Fire core along conductive fractures without placing new sources", () => {
  const { state, map, field } = magicCountry(["fire"], {
    "magic:fire:origin:vein:source": ["relative-intensity", (x, y) => (nearCore(x, y) ? 900 : 0)],
    fracture: ["ratio", (x, y) => (Math.abs(y - 10000) <= 2500 ? 1 : 0)],
  });
  respondMagic(state);
  const fire = field("fire"),
    middle = cellAt(map.mesh, 20000, 10000),
    along = cellAt(map.mesh, 30000, 10000),
    across = cellAt(map.mesh, 20000, 2000);
  expect(fire.intensity.get(middle)).toBeGreaterThan(0);
  expect(fire.intensity.get(along)).toBeGreaterThan(fire.intensity.get(across));
  // Only the captured core (and the parent sample's interpolation around it) is a source;
  // favourable rock elsewhere invents none.
  const span = state.regional.parentSpan;
  for (const i of content(state))
    if (
      Math.hypot(
        map.mesh.x(i) + map.mesh.origin[0] - 20000,
        map.mesh.y(i) + map.mesh.origin[1] - 10000
      ) >
      1.5 * span
    )
      expect(fire.source.get(i)).toBe(0);
});

it("does not invent Fire material from favorable rock and heat alone", () => {
  const { state, map, field } = magicCountry(["fire"], {
    geothermal: ["ratio", () => 1],
    fracture: ["ratio", () => 1],
  });
  respondMagic(state);
  const fire = field("fire");
  expect(content(state).every((i) => fire.source.get(i) === 0)).toBe(true);
  expect(content(state).every((i) => fire.intensity.get(i) === 0)).toBe(true);
  void map;
});

it("heats the ground under a Fire field once and re-applies the same heat on re-evaluation", () => {
  const { state, map } = magicCountry(["fire"], {
    "magic:fire:origin:vein:source": ["relative-intensity", (x, y) => (nearCore(x, y) ? 900 : 0)],
  });
  const middle = cellAt(map.mesh, 20000, 10000),
    before = map.Temperature.get(middle);
  respondMagic(state);
  const once = map.Temperature.get(middle);
  expect(once).toBeGreaterThan(before);
  respondMagic(state);
  expect(map.Temperature.get(middle)).toBe(once);
});

it("keeps Pressure's captured rays instead of replaying the ocean's impulses", () => {
  const { state, map, field } = magicCountry(
    ["pressure"],
    {
      water: ["category", () => 1],
      waterDepth: ["metre", () => 2000],
      "magic:pressure:intensity": ["relative-intensity", (x) => (x < 20000 ? 600 : 0)],
    },
    () => -2000
  );
  respondMagic(state);
  const pressure = field("pressure"),
    west = cellAt(map.mesh, 10000, 10000),
    east = cellAt(map.mesh, 30000, 10000);
  expect(pressure.intensity.get(west)).toBe(600);
  expect(pressure.intensity.get(east)).toBe(0);
  expect(content(state).every((i) => pressure.source.get(i) === 0)).toBe(true);
});

it("propagates Greenwood through roots while a bare strip stops it", () => {
  for (const closed of [true, false]) {
    // A stand is old dense canopy: the engine locates it from the captured canopy age. Bare
    // rock (no cover on thin soil) is the barrier roots cannot cross; the strip spans three
    // parent samples so its middle is bare after interpolation.
    const stand = (x: number, y: number) =>
        Math.abs(x - 5000) <= 2500 && Math.abs(y - 10000) <= 2500,
      bare = (x: number) => closed && Math.abs(x - 20000) <= 5000,
      { state, map, field } = magicCountry(["greenwood"], {
        treeCover: ["ratio", (x) => (bare(x) ? 0 : 0.8)],
        soilDepth: ["metre", (x) => (bare(x) ? 0 : 1)],
        canopyAge: ["year", (x, y) => (stand(x, y) ? 1200 : 100)],
        peatCarbon: ["kg-carbon/square-metre", (x, y) => (stand(x, y) ? 20 : 0)],
      });
    respondMagic(state);
    const greenwood = field("greenwood"),
      right = cellAt(map.mesh, 35000, 10000),
      near = cellAt(map.mesh, 9000, 10000);
    if (closed) expect(greenwood.intensity.get(right)).toBe(0);
    else expect(greenwood.intensity.get(right)).toBeGreaterThan(0);
    expect(greenwood.intensity.get(near)).toBeGreaterThan(0);
  }
});

it("reads Salt from its captured material and does not create or consume stock", () => {
  const { state, map, field } = magicCountry(["salt"], {
    "magic:salt:stock:death/brine": [
      "intensity-square-metre",
      (x) => (x > 20000 ? 3000 * 25e6 : 0),
    ],
  });
  const salt = field("salt"),
    total = content(state).reduce((sum, i) => sum + salt.stocks["death/brine"].get(i), 0);
  respondMagic(state);
  expect(salt.intensity.get(cellAt(map.mesh, 30000, 10000))).toBeGreaterThan(
    salt.intensity.get(cellAt(map.mesh, 10000, 10000))
  );
  expect(content(state).reduce((sum, i) => sum + salt.stocks["death/brine"].get(i), 0)).toBeCloseTo(
    total,
    3
  );
});

it("suppresses other fields inside captured Hallowed ground and concentrates them on its rim", () => {
  const { state, map, field } = magicCountry(["fire", "hallowed"], {
    "magic:fire:intensity": ["relative-intensity", () => 400],
    "magic:hallowed:intensity": ["relative-intensity", (x) => (x < 20000 ? 800 : 0)],
    "magic:hallowed:origin:seat:source": ["relative-intensity", (x) => (x < 20000 ? 800 : 0)],
  });
  respondMagic(state);
  const fire = field("fire"),
    inside = cellAt(map.mesh, 5000, 10000),
    far = cellAt(map.mesh, 38000, 10000);
  expect(fire.intensity.get(inside)).toBeLessThan(fire.intensity.get(far) + 1);
});

it("does not activate captured material when its system is disabled", () => {
  const { state, map, field } = magicCountry([], {
    "magic:fire:intensity": ["relative-intensity", () => 900],
    "magic:fire:origin:vein:source": ["relative-intensity", () => 900],
  });
  const temperature = content(state).map((i) => map.Temperature.get(i));
  respondMagic(state);
  const fire = field("fire");
  expect(content(state).every((i) => fire.intensity.get(i) === 0)).toBe(true);
  expect(content(state).map((i) => map.Temperature.get(i))).toEqual(temperature);
});
