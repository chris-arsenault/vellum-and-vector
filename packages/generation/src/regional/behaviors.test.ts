import { expect, it } from "vitest";
import { gridPosition, resolutionCells } from "@atlas/domain";
import { createRegionalState, refinementChannel } from "./capture";
import {
  axisDifference,
  dominantAxis,
  enableMagic,
  regionalFixture,
  runSchedule,
  suppliedFeature,
} from "./fixture";
import { respondMagic } from "./magic/index";
import { regionalSchedule } from "./schedule";
import { usableSlope } from "./seats";
import {
  cellAt,
  distance,
  regionalComponents,
  resolvesRegionalComponent,
  type RegionalState,
} from "./state";

/**
 * Gate A (spec 9.2): predeclared material-impact checks on constructed inputs. Each asserts
 * an observable of the resulting geography, never the input descriptor.
 */

/** High country with a gentle tilt and a strong, uniform structural grain at `degrees`. */
function grainedUpland(degrees: number) {
  const theta = (degrees * Math.PI) / 180;
  return regionalFixture((x, y) => 1400 + x / 400 + y / 900, 40000, 2, {
    tectonicStrain: ["ratio", () => 0.7],
    structuralGrainX: ["ratio", () => Math.cos(2 * theta)],
    structuralGrainY: ["ratio", () => Math.sin(2 * theta)],
  });
}
const mountain = (x: number, y: number) => 100 + x / 25 + Math.abs(y - 20000) / 12;

it("direction has an effect: rotating the supplied grain by 90° rotates the realized structure by at least 45°", () => {
  const axes = [0, 90].map((degrees) => {
    const { state } = grainedUpland(degrees);
    runSchedule(state, ["physical"]);
    return dominantAxis(state);
  });
  for (const axis of axes) expect(axis.coherence).toBeGreaterThan(0.05);
  expect(axisDifference(axes[0].theta, axes[1].theta)).toBeGreaterThanOrEqual(Math.PI / 4);
});

it("character changes organization: ice-carved high ground holds resolved lakes where unglaciated relief holds none", () => {
  const lakes = [0, 60].map((erosion) => {
    const { state } = regionalFixture(mountain, 40000, 2, {
      glacialErosion: ["metre", (x) => (x > 20000 ? erosion : 0)],
      temperature: ["celsius", () => 4],
    });
    runSchedule(state, ["physical"]);
    const g = state.surface;
    let resolved = 0;
    regionalComponents(
      g,
      (i) => g.channels.water.get(i) === 2,
      (members) => {
        if (resolvesRegionalComponent(g, members)) resolved++;
      }
    );
    return resolved;
  });
  expect(lakes[0]).toBe(0);
  expect(lakes[1]).toBeGreaterThan(0);
});

it("an inherited summit is a divide node: the channels run around it and it stands on the realized summit of its massif", () => {
  const f = regionalFixture(
      (x, y) => 300 + 600 * Math.exp(-(((x - 20000) / 8000) ** 2) - ((y - 20000) / 6000) ** 2),
      40000,
      2
    ),
    { state } = f,
    g = state.surface;
  suppliedFeature(
    state,
    "carrow",
    "peak",
    "geology",
    { type: "Point", coordinates: [17000, 21000] },
    { prominence: 500 },
    "Mount Carrow"
  );
  runSchedule(state, ["physical"]);
  const peak = state.domain.world.features.carrow,
    [x, y] = (peak.geometry as GeoJSON.Point).coordinates,
    cell = cellAt(state, x, y),
    seat = cellAt(state, 17000, 21000);
  // No channel within half a parent span of the captured position: the summit's ground is dear.
  for (let i = 0; i < g.active.length; i++)
    if (distance(g, seat, i) < state.parentSpan * 0.5) expect(g.channels.riverOrder.get(i)).toBe(0);
  // The feature moved to a realized summit within reach and kept its identity and provenance.
  expect(distance(g, seat, cell)).toBeLessThanOrEqual(state.parentSpan);
  expect(peak.attributes.anchoredFrom).toEqual([17000, 21000]);
  for (let i = 0; i < g.active.length; i++)
    if (distance(g, cell, i) <= state.parentSpan * 0.3)
      expect(g.channels.elevation.get(i)).toBeLessThanOrEqual(g.channels.elevation.get(cell));
});

/** A known town on a uniform steep flank; no occupation, so no villages compete. */
function steepTown(withTown: boolean) {
  const f = regionalFixture((x) => 100 + x / 5, 40000, 2, {
    populationDensity: ["people/square-kilometre", () => 0],
  });
  const g = f.state.surface,
    cell = Math.floor(g.height / 2) * g.width + Math.floor(g.width / 2),
    p = gridPosition(g, cell);
  if (withTown)
    suppliedFeature(
      f.state,
      "harrow",
      "settlement",
      "settlements",
      { type: "Point", coordinates: [p.x, p.y] },
      { population: 5000 },
      "Harrow"
    );
  runSchedule(f.state, ["physical", "built"]);
  return { ...f, cell };
}

it("town realizes support: on a flank with no usable ground the town's footprint develops usable ground the flank lacks, without flattening the region", () => {
  const withTown = steepTown(true),
    without = steepTown(false),
    g = withTown.state.surface,
    town = withTown.state.domain.world.features.harrow,
    [x, y] = (town.geometry as GeoJSON.Point).coordinates,
    seat = cellAt(withTown.state, x, y),
    start = gridPosition(g, withTown.cell);
  expect(g.channels.slope.get(seat)).toBeLessThanOrEqual(usableSlope);
  expect(town.attributes.sitedFrom).toEqual([start.x, start.y]);
  expect(distance(g, seat, withTown.cell)).toBeLessThanOrEqual(withTown.state.parentSpan);
  // The ground changed where the town is; far from it the fit to the captured base moves
  // the surface by no more than a small fraction of the footprint's change.
  let near = 0,
    nearMost = 0,
    farMost = 0;
  for (let i = 0; i < g.active.length; i++) {
    const delta = Math.abs(
      g.channels.elevation.get(i) - without.state.surface.channels.elevation.get(i)
    );
    if (distance(g, seat, i) <= withTown.state.parentSpan * 1.5) {
      nearMost = Math.max(nearMost, delta);
      if (delta > 0.5) near++;
    } else farMost = Math.max(farMost, delta);
  }
  expect(near).toBeGreaterThanOrEqual(resolutionCells * resolutionCells);
  expect(farMost).toBeLessThan(nearMost * 0.25);
  // The footprint still holds after the later rounds and the refresh: it is a working
  // structure the derivation reads every round, not a one-off stamp.
  const seatRecord = withTown.state.evidence!.seats.find((s) => s.featureId === "harrow")!;
  expect(seatRecord.cell).toBe(seat);
});

/** A valley country with one captured river, supplied as the capture would leave it. */
function riverCountry(
  name: string,
  course: number[][],
  discharge: number,
  extra: Record<string, [string, (x: number, y: number) => number]> = {}
) {
  const f = regionalFixture((x, y) => 100 + x / 100 + Math.abs(y - 20000) / 30, 40000, 2, extra),
    state = f.state;
  suppliedFeature(
    state,
    name.toLowerCase(),
    "river",
    "rivers",
    { type: "LineString", coordinates: course },
    { discharge, order: 3 },
    name
  );
  runSchedule(state, ["physical"]);
  const rivers = Object.values(state.domain.world.features).filter((x) => x.kind === "river"),
    reaches = state.domain.world.drainage!.area.reaches,
    named = rivers.find((x) => x.name === name && x.id !== name.toLowerCase());
  return { ...f, rivers, reaches, named };
}

it("river develops surroundings: an interior source gains feeding tributaries, keeps its name and carries its course as evidence", () => {
  const { state, reaches, named } = riverCountry(
    "Vell",
    [
      [26000, 12000],
      [20000, 17000],
      [12000, 19500],
      [0, 20000],
    ],
    40
  );
  expect(named).toBeDefined();
  expect(named!.placeId).toBe("vell");
  expect((named!.attributes.capturedCourse as { sourceId: string }).sourceId).toBe("vell");
  const index = reaches.findIndex((reach) => reach.featureIds[0] === named!.id),
    tributaries = reaches.filter((reach) => reach.downstream === index);
  expect(tributaries.length).toBeGreaterThanOrEqual(2);
  const source = (named!.geometry as GeoJSON.LineString).coordinates[0];
  expect(state.surface.channels.water.get(cellAt(state, source[0], source[1]))).toBe(0);
  // The coarse captured line left the map; the developed stem stands for it.
  expect(state.domain.world.features.vell).toBeUndefined();
});

it("river develops surroundings: a river entering across the frame keeps its edge source instead of a fabricated interior one", () => {
  const { state, named } = riverCountry(
    "Ash",
    [
      [40000, 20000],
      [34000, 20500],
      [28000, 20000],
      [0, 20000],
    ],
    120,
    {
      riverOrder: ["category", (x, y) => (Math.abs(y - 20000) < 1500 && x > 26000 ? 4 : 0)],
      flow: ["cubic-metre/second", (x, y) => (Math.abs(y - 20000) < 1500 && x > 26000 ? 120 : 0)],
    }
  );
  expect(named).toBeDefined();
  const g = state.surface,
    coordinates = (named!.geometry as GeoJSON.LineString).coordinates,
    [x] = coordinates[0];
  // The stem begins at the east frame edge, carrying the captured discharge.
  expect(x).toBeGreaterThan(g.bounds[2] - 2 * (g.scope.resolution ?? 1000));
  expect(
    Number(named!.attributes.discharges ? (named!.attributes.discharges as number[])[0] : 0)
  ).toBeGreaterThan(100);
});

it("repeating a refinement reproduces it: a second run from the first run's published features gives the same surface", () => {
  const build = () => {
    const f = regionalFixture(mountain, 40000, 2, {
      populationDensity: ["people/square-kilometre", () => 30],
    });
    suppliedFeature(
      f.state,
      "vell",
      "river",
      "rivers",
      {
        type: "LineString",
        coordinates: [
          [26000, 12000],
          [12000, 19500],
          [0, 20000],
        ],
      },
      { discharge: 40, order: 3 },
      "Vell"
    );
    suppliedFeature(
      f.state,
      "harrow",
      "settlement",
      "settlements",
      { type: "Point", coordinates: [30000, 24000] },
      { population: 3000 },
      "Harrow"
    );
    suppliedFeature(
      f.state,
      "carrow",
      "peak",
      "geology",
      { type: "Point", coordinates: [34000, 18000] },
      { prominence: 400 },
      "Mount Carrow"
    );
    return f;
  };
  const first = build();
  runSchedule(first.state, ["physical", "built"]);
  const second = build();
  for (const f of Object.values(first.state.domain.world.features))
    second.source.world.features[f.id] = structuredClone(f);
  second.state = createRegionalState(second.source, second.input);
  runSchedule(second.state, ["physical", "built"]);
  for (const name of ["elevation", "riverOrder", "water", "treeCover"])
    expect(Array.from(second.state.surface.channels[name]), name).toEqual(
      Array.from(first.state.surface.channels[name])
    );
});

it("feedback crosses rounds: Fire changing the rock in round one changes where the later rounds' relief is cut", () => {
  const runs = [true, false].map((fire) => {
    const { state } = regionalFixture(mountain, 40000, 2, {
      "magic:fire:intensity": ["relative-intensity", () => 0],
      "magic:fire:source": [
        "relative-intensity",
        (x, y) => (x < 20000 && Math.abs(y - 20000) < 6000 ? 900 : 0),
      ],
      fracture: ["ratio", () => 0.1],
    });
    enableMagic(state, fire ? ["fire"] : []);
    runSchedule(state, ["physical", "magic"]);
    const g = state.surface;
    return {
      elevation: Array.from(g.channels.elevation),
      fracture: Math.max(...g.channels.fracture),
    };
  });
  // The medium changed where Fire reached...
  expect(runs[0].fracture).toBeGreaterThan(runs[1].fracture);
  // ...and the relief derived from it differs materially there.
  let differing = 0;
  for (let i = 0; i < runs[0].elevation.length; i++)
    if (Math.abs(runs[0].elevation[i] - runs[1].elevation[i]) > 1) differing++;
  expect(differing).toBeGreaterThanOrEqual(resolutionCells * resolutionCells);
});

it("all seven remain meaningful: each enabled system develops through its own medium and re-evaluation does not ratchet", () => {
  const { state } = regionalFixture((x, y) => (x < 6000 ? -1500 : mountain(x, y)), 40000, 2, {
      water: ["category", (x) => (x < 6000 ? 1 : 0)],
      waterDepth: ["metre", (x) => (x < 6000 ? 1500 : 0)],
      // Supplied on the coarse parent samples (5 km east, 10 km north): each block holds
      // at least one sample.
      temperature: ["celsius", (x) => (x >= 35000 ? -12 : 14)],
      ice: ["ratio", (x) => (x >= 35000 ? 1 : 0)],
      treeCover: ["ratio", () => 0.7],
      "magic:fire:source": [
        "relative-intensity",
        (x, y) => (x >= 10000 && x <= 15000 && y === 20000 ? 900 : 0),
      ],
      "magic:aurora:stock:field/ice": ["intensity-square-metre", (x) => (x >= 35000 ? 4e9 : 0)],
      "magic:pressure:source": [
        "relative-intensity",
        (x, y) => (x <= 5000 && y === 20000 ? 900 : 0),
      ],
      "magic:greenwood:source": [
        "relative-intensity",
        (x, y) => (x >= 20000 && x <= 25000 && y === 10000 ? 900 : 0),
      ],
      "magic:salt:stock:death/bed": [
        "intensity-square-metre",
        (x, y) => (x >= 25000 && x <= 30000 && y === 0 ? 6e9 : 0),
      ],
      "magic:hallowed:coverage": [
        "ratio",
        (x, y) => (x >= 15000 && x <= 20000 && y === 30000 ? 0.4 : 0),
      ],
    }),
    systems = enableMagic(state),
    g = state.surface;
  // Veil needs the strain of two systems meeting: Fire and Aurora overlap on the east.
  g.channels["magic:fire:source"].set(Math.floor(g.height / 2) * g.width + g.width - 4, 900);
  for (const step of regionalSchedule(["physical", "magic"])) {
    step.run(state);
    if (step.id === "round-1/environment") break;
  }
  const fields = systems.map((system) => Array.from(g.channels[`magic:${system.id}:intensity`]));
  for (const [k, values] of fields.entries())
    expect(
      values.some((v) => v > 0),
      systems[k].id
    ).toBe(true);
  for (let a = 0; a < fields.length; a++)
    for (let b = a + 1; b < fields.length; b++)
      expect(correlation(fields[a], fields[b]), `${systems[a].id}/${systems[b].id}`).toBeLessThan(
        0.99
      );
  expectConvergence(state, systems);
});

/**
 * Re-evaluating against the media the first evaluation produced converges: Fire's own
 * fracture opening is bounded by the declared effect and every later change is no larger
 * than the one before it. Nothing accumulates.
 */
function expectConvergence(state: RegionalState, systems: ReturnType<typeof enableMagic>) {
  const g = state.surface,
    natural = state.natural.fracture,
    opening =
      systems.find((s) => s.id === "fire")!.effects.conduitOpening / 1000 +
      Math.max(
        0,
        ...(state.domain.world.confluences ?? []).map((m) => m.effects.fractureConductance / 1000)
      ),
    snapshot = () => ({
      fields: systems.map((system) => Array.from(g.channels[`magic:${system.id}:intensity`])),
      elevation: Array.from(g.channels.elevation),
    }),
    difference = (a: ReturnType<typeof snapshot>, b: ReturnType<typeof snapshot>) =>
      Math.max(
        ...a.fields.map((values, k) =>
          Math.max(...values.map((v, i) => Math.abs(v - b.fields[k][i])))
        ),
        ...a.elevation.map((v, i) => Math.abs(v - b.elevation[i]))
      ),
    first = snapshot();
  respondMagic(state);
  const second = snapshot();
  respondMagic(state);
  const third = snapshot();
  expect(difference(second, third)).toBeLessThanOrEqual(difference(first, second) + 1e-9);
  for (let i = 0; i < g.active.length; i++)
    expect(g.channels.fracture.get(i)).toBeLessThanOrEqual(natural.get(i) + opening + 1e-9);
  // Systems whose medium the evaluation does not itself change settle at once; Aurora holds
  // ice that it then reads, so it converges rather than repeats.
  for (const id of ["pressure", "hallowed"])
    expect(Array.from(g.channels[`magic:${id}:intensity`]), id).toEqual(
      second.fields[systems.findIndex((s) => s.id === id)]
    );
}

function correlation(a: number[], b: number[]) {
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length,
    ma = mean(a),
    mb = mean(b),
    sum = (f: (i: number) => number) => a.reduce((s, _, i) => s + f(i), 0),
    sab = sum((i) => (a[i] - ma) * (b[i] - mb)),
    saa = sum((i) => (a[i] - ma) ** 2),
    sbb = sum((i) => (b[i] - mb) ** 2);
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}

it("descendants use their parent: a completed child publishes its developed grain through the captured-channel contract", () => {
  const { state } = grainedUpland(30);
  runSchedule(state, ["physical"]);
  const g = state.surface;
  expect(refinementChannel("structuralGrainX")).toBe(true);
  expect(refinementChannel("structuralGrainY")).toBe(true);
  expect(g.channels.structuralGrainX).toBeDefined();
  let coherent = 0;
  for (let i = 0; i < g.active.length; i++)
    if (Math.hypot(g.channels.structuralGrainX.get(i), g.channels.structuralGrainY.get(i)) > 0.2)
      coherent++;
  expect(coherent).toBeGreaterThan(g.active.length / 4);
  // A deliberately rotated child grain, captured by a grandchild, rotates the realized structure.
  const rotated = [0, 90].map((extra) => {
    const child = regionalFixture((x, y) => 900 + x / 600 + y / 1200, 40000, 2, {
      tectonicStrain: ["ratio", () => 0.6],
      structuralGrainX: ["ratio", () => Math.cos(2 * (Math.PI / 6 + (extra * Math.PI) / 180))],
      structuralGrainY: ["ratio", () => Math.sin(2 * (Math.PI / 6 + (extra * Math.PI) / 180))],
    });
    runSchedule(child.state, ["physical"]);
    return dominantAxis(child.state).theta;
  });
  expect(axisDifference(rotated[0], rotated[1])).toBeGreaterThanOrEqual(Math.PI / 4);
});
