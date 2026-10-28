import { expect, it } from "vitest";
import {
  createGrid,
  generateBand,
  gridPosition,
  isSocietyWork,
  putChannel,
  rectangle,
  residentBand,
  type Grid,
} from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import { initializePopulation } from "./societyPopulation";
import { refreshSocietyConnections } from "./societyGeography";
import { realizeDemands, siteQuality } from "./societyDemand";
import { applyPresentWorks, makeWork } from "./societyWorks";
import { publishSocietyWorks } from "./societyWorkPublication";
import { retainSocietyFootprints } from "./societyInheritance";
import type { MapProcessContext } from "./process";

/** A 13 × 5 Region grid with one river along the middle row and a gorge at columns 8 to 10. */
function fixture() {
  const state = landscape();
  state.domain.world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  state.domain.world.areas.area.profile = "region";
  const footprint = rectangle([0, 0, 130000, 50000]);
  state.domain.scope.footprint = footprint;
  state.domain.world.areas.area.footprint = footprint;
  state.surface = createGrid("region", state.domain.scope, 13, 5);
  const n = 65,
    column = (i: number) => i % 13,
    row = (i: number) => Math.floor(i / 13);
  const elevation = new Float64Array(n).map((_, i) =>
    row(i) === 2 ? 100 : column(i) >= 8 && column(i) <= 10 ? 400 : 120
  );
  const river = new Float64Array(n).map((_, i) => (row(i) === 2 ? 1 : 0));
  const flow = new Float64Array(n).map((_, i) => (row(i) === 2 ? 10 + column(i) : 0));
  putChannel(state.surface, "elevation", "metre", residentBand("float64", elevation));
  putChannel(state.surface, "riverOrder", "count", residentBand("float64", river));
  putChannel(state.surface, "flow", "cubic-metre/second", residentBand("float64", flow));
  putChannel(
    state.surface,
    "treeCover",
    "ratio",
    residentBand("float64", new Float64Array(n).fill(0.2))
  );
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: {},
    epochs: [epoch("Settlement", 200)],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
  };
  initializePopulation(state, context);
  state.society!.region.communities = state.society!.region.communities.slice(0, 1);
  refreshSocietyConnections(state);
  const c = state.society!.region.communities[0];
  c.groups[0].count = 2000;
  c.status = "inhabited";
  c.position = gridPosition(state.surface, 13 * 2 + 1); // the seat at the river's west end
  return { state, c };
}

it("realizes an inherited dam demand on the gorge, not on the river cell nearest the seat", () => {
  const { state, c } = fixture();
  const dam = makeWork(state, c, "dam", c.position);
  dam.demand = { amount: 4, unit: "cubic-metre/second" };
  state.society!.region.works = [dam];
  // The middle of the gorge has walls on every side; its ends have walls on one side and
  // more flow downstream, and the plain below it has the most flow and no walls.
  const gorge = 13 * 2 + 9;
  expect(siteQuality(state, "dam", gorge)).toBeGreaterThan(siteQuality(state, "dam", 13 * 2 + 10));
  expect(siteQuality(state, "dam", gorge)).toBeGreaterThan(siteQuality(state, "dam", 13 * 2 + 12));
  realizeDemands(state);
  expect(dam.demand).toBeUndefined();
  expect(dam.realizedAt).toBe("area");
  expect(dam.position).toEqual(gridPosition(state.surface, gorge));
  expect(dam.causes.at(-1)).toContain("4.00 cubic-metre/second");
  // The present applies what this profile realized, and only once.
  const before = state.surface.channels.elevation.get(gorge);
  state.society!.inherited = true;
  applyPresentWorks(state);
  expect(state.surface.channels.elevation.get(gorge)).toBeGreaterThan(before);
  expect(dam.applied).toBe(dam.magnitude * dam.condition);
  const raised = state.surface.channels.elevation.get(gorge);
  applyPresentWorks(state);
  expect(state.surface.channels.elevation.get(gorge)).toBe(raised);
});

it("searches the whole inherited country for a site and gives the work to the heir whose land holds it", () => {
  const { state, c } = fixture();
  // Split the country: the first heir keeps the west without the river, the second the east.
  const east = { ...structuredClone(c), id: "east-heir", name: "East", groups: [] };
  east.position = gridPosition(state.surface, 13 * 2 + 11);
  state.society!.region.communities.push(east);
  for (let i = 0; i < state.society!.owner.length; i++)
    state.society!.owner.set(i, i % 13 >= 6 ? 1 : 0);
  const dam = makeWork(state, c, "dam", c.position);
  dam.demand = { amount: 4, unit: "cubic-metre/second" };
  dam.country = [c.id, east.id];
  state.society!.region.works = [dam];
  realizeDemands(state);
  expect(dam.position).toEqual(gridPosition(state.surface, 13 * 2 + 9));
  expect(dam.communityId).toBe(east.id);
  expect(dam.country).toBeUndefined();
});

it("never publishes a demand as a feature, at World or at a finer profile", () => {
  const { state, c } = fixture();
  const harbor = makeWork(state, c, "harbor", c.position);
  harbor.demand = { amount: 2000, unit: "people", unmet: 2000 };
  const dam = makeWork(state, c, "dam", gridPosition(state.surface, 13 * 2 + 9));
  state.society!.region.works = [harbor, dam];
  publishSocietyWorks(state);
  const published = Object.values(state.domain.world.features).filter(isSocietyWork);
  expect(published.map((f) => f.kind)).toEqual(["dam"]);
});

function channel(grid: Grid, name: string, unit: string, value: (i: number) => number) {
  putChannel(grid, name, unit, generateBand(grid.coverage, "float64", name, value));
}
it("inherits a World dam demand into a child and realizes it on the child's own river", () => {
  // The World: one unit over the whole 300 × 100 km country, demanding a dam.
  const world = landscape();
  world.domain.world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  const footprint = rectangle([0, 0, 300000, 100000]);
  world.domain.scope.footprint = footprint;
  world.domain.world.areas.area.footprint = footprint;
  world.surface = createGrid("society", world.domain.scope, 13, 5);
  channel(world.surface, "elevation", "metre", () => 100);
  const context: MapProcessContext = {
    scope: world.domain.scope,
    invocation: [],
    parameters: {},
    epochs: [epoch("Settlement", 200)],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
  };
  initializePopulation(world, context);
  const prior = world.society!.region;
  prior.communities = prior.communities.slice(0, 1);
  refreshSocietyConnections(world);
  const unit = prior.communities[0];
  unit.groups[0].count = 3000;
  unit.status = "inhabited";
  unit.founded = "Settlement";
  const dam = makeWork(world, unit, "dam");
  expect(dam.demand).toBeDefined();
  prior.works = [dam];
  retainSocietyFootprints(world);
  // The child: the west half, with a river the World never resolved along its middle row.
  const childFootprint = rectangle([0, 0, 150000, 100000]);
  world.domain.world.areas.child = {
    ...world.domain.world.areas.area,
    id: "child",
    parentId: "area",
    footprint: childFootprint,
    profile: "region",
  };
  world.domain.scope = { ...world.domain.scope, areaId: "child", footprint: childFootprint };
  world.surface = createGrid("child", world.domain.scope, 15, 9);
  const row = (i: number) => Math.floor(i / 15);
  channel(world.surface, "elevation", "metre", () => 100);
  channel(world.surface, "riverOrder", "count", (i) => (row(i) === 4 ? 1 : 0));
  channel(world.surface, "flow", "cubic-metre/second", (i) => (row(i) === 4 ? 20 : 0));
  initializePopulation(world, { ...context, scope: world.domain.scope });
  const inherited = world.society!.region.works.find((w) => w.kind === "dam")!;
  expect(inherited.demand).toBeUndefined();
  expect(inherited.realizedAt).toBe("child");
  expect(inherited.country).toBeUndefined();
  const cell = Array.from(world.surface.channels.riverOrder).findIndex(
    (_, i) =>
      gridPosition(world.surface, i).x === inherited.position.x &&
      gridPosition(world.surface, i).y === inherited.position.y
  );
  expect(cell).toBeGreaterThanOrEqual(0);
  expect(row(cell)).toBe(4);
  expect(world.society!.region.communities.some((c) => c.id === inherited.communityId)).toBe(true);
});

it("keeps a demand with no medium here latent and records its whole amount as unmet", () => {
  const { state, c } = fixture();
  const harbor = makeWork(state, c, "harbor", c.position);
  harbor.demand = { amount: 2000, unit: "people" };
  state.society!.region.works = [harbor];
  realizeDemands(state);
  expect(harbor.demand).toEqual({ amount: 2000, unit: "people", unmet: 2000 });
  expect(harbor.realizedAt).toBeUndefined();
  state.society!.inherited = true;
  const elevation = state.surface.channels.elevation.toArray();
  applyPresentWorks(state);
  expect(Array.from(state.surface.channels.elevation)).toEqual(Array.from(elevation));
});
