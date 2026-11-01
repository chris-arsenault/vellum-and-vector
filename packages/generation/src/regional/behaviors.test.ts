import { expect, it } from "vitest";
import { gridPosition, resolutionCells } from "@atlas/domain";
import { refinementChannel } from "./capture";
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
import {
  channel,
  regionalComponents,
  resolvesRegionalComponent,
  type RegionalState,
} from "./state";
import { applySupports, realizeSupports, usableSlope } from "./supports";
import { updateSlopes } from "./terrain";

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

/** A known town on a uniform steep flank; no occupation, so no villages compete. */
function steepTown(withTown: boolean, run = true) {
  const f = regionalFixture((x) => 100 + x / 5, 40000, 2, {
    populationDensity: ["people/square-kilometre", () => 0],
  });
  const g = f.state.surface,
    cell = Math.floor(g.height / 2) * g.width + Math.floor(g.width / 2),
    p = gridPosition(g, cell),
    town = withTown
      ? suppliedFeature(
          f.state,
          "harrow",
          "settlement",
          "settlements",
          { type: "Point", coordinates: [p.x, p.y] },
          { population: 5000 },
          "Harrow"
        )
      : undefined;
  if (run) runSchedule(f.state, ["physical", "built"]);
  return { ...f, cell, town };
}

it("town realizes support: on a flank with no usable ground a bounded terrace is shaped and the region is not flattened", () => {
  // No evolution here: the plane is unusable everywhere, so the support must be a terrace.
  const { state, cell, town } = steepTown(true, false),
    g = state.surface,
    before = Array.from(g.channels.elevation);
  channel(state, "water", "category");
  updateSlopes(state);
  realizeSupports(state, [{ feature: town!, cell }], []);
  updateSlopes(state);
  const support = state.supports[0];
  expect(support.kind).toBe("terrace");
  expect(g.channels.slope.get(support.cell)).toBeLessThanOrEqual(usableSlope);
  const [x, y] = (town!.geometry as GeoJSON.Point).coordinates;
  expect(cellAtPosition(state, x, y)).toBe(support.cell);
  let changed = 0,
    far = 0;
  for (let i = 0; i < g.active.length; i++) {
    const delta = Math.abs(g.channels.elevation.get(i) - before[i]);
    if (delta <= 0.5) continue;
    changed++;
    if (
      Math.hypot(
        gridPosition(g, i).x - gridPosition(g, support.cell).x,
        gridPosition(g, i).y - gridPosition(g, support.cell).y
      ) >
      state.parentSpan * 1.5
    )
      far++;
  }
  expect(changed).toBeGreaterThanOrEqual(resolutionCells * resolutionCells);
  expect(changed).toBeLessThan(g.active.length * 0.05);
  expect(far).toBe(0);
  // Re-applying the support updates it toward its level rather than cutting again.
  const once = Array.from(g.channels.elevation);
  applySupports(state);
  expect(Array.from(g.channels.elevation)).toEqual(once);
});

it("town realizes support through the schedule: an inherited town on a steep flank ends on usable ground it did not start on", () => {
  const { state, cell } = steepTown(true),
    g = state.surface,
    town = state.domain.world.features.harrow,
    [x, y] = (town.geometry as GeoJSON.Point).coordinates,
    seat = cellAtPosition(state, x, y);
  expect(g.channels.slope.get(seat)).toBeLessThanOrEqual(usableSlope);
  expect(["site", "terrace"]).toContain(town.attributes.support);
  expect(town.attributes.sitedFrom).toEqual(
    gridPosition(g, cell).x
      ? [gridPosition(g, cell).x, gridPosition(g, cell).y]
      : town.attributes.sitedFrom
  );
  expect(state.supports.some((s) => s.featureId === "harrow")).toBe(true);
});

function cellAtPosition(state: RegionalState, x: number, y: number) {
  const g = state.surface;
  return (
    Math.round(((y - g.bounds[1]) / (g.bounds[3] - g.bounds[1])) * (g.height - 1)) * g.width +
    Math.round(((x - g.bounds[0]) / (g.bounds[2] - g.bounds[0])) * (g.width - 1))
  );
}

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

it("river develops surroundings: an interior source gains feeding tributaries, keeps its name and no headwater lake is imposed", () => {
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
  const index = reaches.findIndex((reach) => reach.featureIds[0] === named!.id),
    tributaries = reaches.filter((reach) => reach.downstream === index);
  expect(tributaries.length).toBeGreaterThanOrEqual(2);
  const source = (named!.geometry as GeoJSON.LineString).coordinates[0];
  expect(state.surface.channels.water.get(cellAtPosition(state, source[0], source[1]))).toBe(0);
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

it("feedback crosses rounds: Fire changing the rock in round one changes where the later rounds' terrain erodes", () => {
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
    let inside = 0,
      changedInside = 0;
    const erosion = Array.from(g.channels.erosion);
    for (let i = 0; i < g.active.length; i++) {
      const p = gridPosition(g, i);
      if (p.x < 20000 && Math.abs(p.y - 20000) < 6000) {
        inside += erosion[i];
        changedInside++;
      }
    }
    return {
      erosion,
      inside,
      fracture: Math.max(...g.channels.fracture),
      rock: Math.max(...g.channels.rock),
      zone: changedInside,
    };
  });
  // The medium changed where Fire reached...
  expect(runs[0].fracture).toBeGreaterThan(runs[1].fracture);
  // ...and the terrain's response to it differs materially inside the zone.
  expect(Math.abs(runs[0].inside - runs[1].inside)).toBeGreaterThan(0.02 * runs[1].inside);
  let differing = 0;
  for (let i = 0; i < runs[0].erosion.length; i++)
    if (Math.abs(runs[0].erosion[i] - runs[1].erosion[i]) > 1) differing++;
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
  // Re-evaluating against the media the first evaluation produced converges: Fire's own
  // fracture opening is bounded by the declared effect and every later change is no larger
  // than the one before it. Nothing accumulates.
  const natural = state.natural.fracture,
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
  for (const id of ["aurora", "pressure", "hallowed"])
    expect(Array.from(g.channels[`magic:${id}:intensity`]), id).toEqual(
      second.fields[systems.findIndex((s) => s.id === id)]
    );
});

function correlation(a: number[], b: number[]) {
  const n = a.length,
    ma = a.reduce((s, v) => s + v, 0) / n,
    mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0,
    saa = 0,
    sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}

it("working structures survive interaction: a support made in round one is still effective after the later rounds and the refresh", () => {
  const { state } = steepTown(true),
    g = state.surface,
    support = state.supports.find((s) => s.featureId === "harrow")!;
  expect(support).toBeDefined();
  expect(g.channels.slope.get(support.cell)).toBeLessThanOrEqual(usableSlope);
  if (support.kind === "terrace") {
    expect(Math.abs(g.channels.elevation.get(support.cell) - support.level!)).toBeLessThan(15);
    const once = Array.from(g.channels.elevation);
    applySupports(state);
    expect(Array.from(g.channels.elevation)).toEqual(once);
  }
});

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
      structuralGrainX: [
        "ratio",
        (x, y) =>
          Math.cos(2 * (Math.PI / 6 + (extra * Math.PI) / 180)) * Math.min(1, 1 + 0 * x + 0 * y),
      ],
      structuralGrainY: ["ratio", () => Math.sin(2 * (Math.PI / 6 + (extra * Math.PI) / 180))],
    });
    runSchedule(child.state, ["physical"]);
    return dominantAxis(child.state).theta;
  });
  expect(axisDifference(rotated[0], rotated[1])).toBeGreaterThanOrEqual(Math.PI / 4);
});
