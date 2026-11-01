import { expect, it, vi } from "vitest";

// World-depth runs on a supplied country: longer than the suite's default per-test budget.
vi.setConfig({ testTimeout: 120_000 });
import { resolutionCells } from "@atlas/domain";
import { refinementChannel } from "./capture";
import {
  axisDifference,
  dominantAxis,
  regionalFixture,
  regionalWorkingState,
  runSchedule,
  suppliedFeature,
} from "./fixture";
import { cellAt, components, distance, isContent, positionOf, regionalSpan } from "./lattice";
import { usableSlope } from "./seats";
import type { RegionalState } from "./state";

/**
 * Gate A (spec 9.2): predeclared material-impact checks on constructed inputs. Each asserts
 * an observable of the resulting geography, never the input descriptor. The magic checks
 * are in `magicBehaviors.test.ts`.
 */

const height = (state: RegionalState, i: number) =>
  (state.physical.map.Elevation.get(i) - state.physical.map.EffectiveSeaLevel) / 1024;
function contentCells(state: RegionalState) {
  const mesh = state.physical.map.mesh,
    cells: number[] = [];
  for (let i = 0; i < mesh.count; i++) if (isContent(mesh, i)) cells.push(i);
  return cells;
}

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
    const map = state.physical.map,
      mesh = map.mesh,
      span = regionalSpan(state);
    let resolved = 0;
    // A lake the map resolves: several cells, and long enough along one axis to be a
    // feature rather than a wet cell (a ribbon lake in a trough counts).
    components(
      mesh,
      (i) => map.WaterKindCodes.get(i) === 2,
      (members) => {
        const xs = Array.from(members, (i) => mesh.x(i)),
          ys = Array.from(members, (i) => mesh.y(i)),
          length = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        if (members.length >= 3 && length >= 2 * span) resolved++;
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
    map = state.physical.map,
    mesh = map.mesh;
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
    cell = cellAt(mesh, x, y),
    seat = cellAt(mesh, 17000, 21000),
    span = state.regional.parentSpan;
  // No channel within half a parent span of the captured position: the summit's ground is dear.
  for (const i of contentCells(state))
    if (distance(mesh, seat, i) < span * 0.5) expect(map.RiverOrders.get(i)).toBe(0);
  // The feature moved to a realized summit within reach and kept its identity and provenance.
  expect(distance(mesh, seat, cell)).toBeLessThanOrEqual(span);
  expect(peak.attributes.anchoredFrom).toEqual([17000, 21000]);
  for (const i of contentCells(state))
    if (distance(mesh, cell, i) <= span * 0.3)
      expect(height(state, i)).toBeLessThanOrEqual(height(state, cell));
});

/** A known town on a uniform steep flank; no occupation, so no villages compete. */
function steepTown(withTown: boolean) {
  const f = regionalFixture((x) => 100 + x / 5, 40000, 2, {
    populationDensity: ["people/square-kilometre", () => 0],
  });
  const mesh = f.state.physical.map.mesh,
    cell = cellAt(mesh, 20000, 20000),
    p = positionOf(mesh, cell);
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
    map = withTown.state.physical.map,
    mesh = map.mesh,
    town = withTown.state.domain.world.features.harrow,
    [x, y] = (town.geometry as GeoJSON.Point).coordinates,
    seat = cellAt(mesh, x, y),
    start = positionOf(mesh, withTown.cell),
    span = withTown.state.regional.parentSpan;
  expect(map.Slope.get(seat)).toBeLessThanOrEqual(usableSlope);
  expect(town.attributes.sitedFrom).toEqual([start.x, start.y]);
  expect(distance(mesh, seat, withTown.cell)).toBeLessThanOrEqual(span);
  // The ground changed where the town is; far from it the fit to the captured base moves
  // the surface by no more than a small fraction of the footprint's change.
  let near = 0,
    nearMost = 0,
    farMost = 0;
  for (const i of contentCells(withTown.state)) {
    const delta = Math.abs(height(withTown.state, i) - height(without.state, i));
    if (distance(mesh, seat, i) <= span * 1.5) {
      nearMost = Math.max(nearMost, delta);
      if (delta > 0.5) near++;
    } else farMost = Math.max(farMost, delta);
  }
  expect(near).toBeGreaterThanOrEqual(resolutionCells * resolutionCells);
  expect(farMost).toBeLessThan(nearMost * 0.25);
  // The footprint still holds after the later rounds and the refresh: it is a working
  // structure the derivation reads every round, not a one-off stamp.
  const seatRecord = withTown.state.regional.evidence!.seats.find((s) => s.featureId === "harrow")!;
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
    named = rivers.filter((x) => x.name === name && x.id !== name.toLowerCase());
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
  expect(named.length).toBeGreaterThan(0);
  for (const reach of named) {
    expect(reach.placeId).toBe("vell");
    expect((reach.attributes.capturedCourse as { sourceId: string }).sourceId).toBe("vell");
  }
  // Other reaches feed the named stem.
  const stem = new Set(
      reaches.map((reach, index) => (named.some((n) => n.id === reach.featureIds[0]) ? index : -1))
    ),
    tributaries = reaches.filter(
      (reach, index) => !stem.has(index) && reach.downstream !== null && stem.has(reach.downstream)
    );
  expect(tributaries.length).toBeGreaterThanOrEqual(2);
  // The stem rises on land (its source is a developed headwater, not a lake or the sea).
  const heads = named.map((n) => (n.geometry as GeoJSON.LineString).coordinates[0]),
    source = heads.reduce((a, b) => (a[0] > b[0] ? a : b));
  expect(
    state.physical.map.WaterKindCodes.get(cellAt(state.physical.map.mesh, source[0], source[1]))
  ).toBe(0);
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
  expect(named.length).toBeGreaterThan(0);
  // The stem begins at the east frame edge, carrying the captured discharge.
  const heads = named.map((n) => (n.geometry as GeoJSON.LineString).coordinates[0]),
    [x] = heads.reduce((a, b) => (a[0] > b[0] ? a : b));
  expect(x).toBeGreaterThan(state.surface.bounds[2] - 2 * regionalSpan(state));
  const entering = named.find((n) => (n.geometry as GeoJSON.LineString).coordinates[0][0] === x)!;
  expect(
    Number(entering.attributes.discharges ? (entering.attributes.discharges as number[])[0] : 0)
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
  second.state = regionalWorkingState(second.source, second.input);
  runSchedule(second.state, ["physical", "built"]);
  for (const name of ["Elevation", "RiverOrders", "WaterKindCodes", "TreeCover"] as const)
    expect(Array.from(second.state.physical.map[name].toArray()), name).toEqual(
      Array.from(first.state.physical.map[name].toArray())
    );
});

it("descendants use their parent: a completed child publishes its developed grain through the captured-channel contract", () => {
  const { state } = grainedUpland(30);
  runSchedule(state, ["physical"]);
  expect(refinementChannel("structuralGrainX")).toBe(true);
  expect(refinementChannel("structuralGrainY")).toBe(true);
  expect(state.surface.channels.structuralGrainX).toBeDefined();
  const g = state.surface;
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
