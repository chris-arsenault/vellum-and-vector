import { expect, it } from "vitest";
import { gridPosition, point, type SocietyCommunity } from "@atlas/domain";
import { regionalEnvironment } from "./refinementFixture";
import { refinePlaces, regionalPath } from "./places";
import { putRefinementFeature } from "./features";
import { regionalCommunitySpacing } from "../regionalSociety";
import { channel } from "./state";
import { emptySupport } from "../societySupport";

it("leaves an unoccupied dry interior empty instead of filling every suitable location", () => {
  const { state } = regionalEnvironment();
  state.surface.channels.rainfall.fill(0.04);
  state.surface.channels.runoff.fill(0);
  state.surface.channels.catchmentArea.fill(1e11);
  channel(state, "populationDensity", "people/square-kilometre", 0);
  refinePlaces(state);
  expect(
    Object.values(state.domain.world.features).filter((f) => f.kind === "settlement")
  ).toHaveLength(0);
});

it("retains a known town and adds named smaller settlements and local ways on plains", () => {
  const { state } = regionalEnvironment(),
    p = gridPosition(state.surface, state.surface.width + 2),
    known = putRefinementFeature(
      state,
      "known",
      "settlement",
      "settlements",
      point(p),
      { population: 10000 },
      "Known town"
    );
  known.name = "Known town";
  channel(state, "populationDensity", "people/square-kilometre", 100);
  known.placeId = "original-town";
  const before = structuredClone(known),
    history = structuredClone(state.domain.world.epochs);
  refinePlaces(state);
  const features = Object.values(state.domain.world.features),
    villages = features.filter((f) => f.attributes.scale === "village");
  expect(state.domain.world.features[known.id]).toEqual(before);
  expect(villages.length).toBeGreaterThan(1);
  expect(
    villages.every((f) => Number(f.attributes.population) < 10000 && f.name !== "Village")
  ).toBe(true);
  expect(features.some((f) => f.kind === "road")).toBe(true);
  for (const [i, a] of villages.entries())
    for (const b of villages.slice(i + 1))
      expect(
        Math.hypot(
          (a.geometry as GeoJSON.Point).coordinates[0] -
            (b.geometry as GeoJSON.Point).coordinates[0],
          (a.geometry as GeoJSON.Point).coordinates[1] -
            (b.geometry as GeoJSON.Point).coordinates[1]
        )
      ).toBeGreaterThanOrEqual(regionalCommunitySpacing(state) - 1e-3);
  expect(state.domain.world.epochs).toEqual(history);
});
it("routes local ways around supplied water through a dry passage", () => {
  const { state } = regionalEnvironment(),
    g = state.surface,
    col = Math.floor(g.width / 2),
    pass = g.height - 2;
  for (let y = 0; y < g.height; y++) if (y !== pass) g.channels.water.set(y * g.width + col, 1);
  const start = 2 * g.width + 2,
    end = 2 * g.width + g.width - 3,
    path = regionalPath(state, start, end)!;
  expect(path[0]).toBe(start);
  expect(path.at(-1)).toBe(end);
  expect(path).toContain(pass * g.width + col);
  expect(path.every((i) => g.channels.water.get(i) === 0)).toBe(true);
});
it("retains neighboring captured towns without creating a one-point road in their shared cell", () => {
  const { state } = regionalEnvironment(),
    p = gridPosition(state.surface, state.surface.width + 2);
  const towns = [0, 100].map((offset, i) =>
    putRefinementFeature(
      state,
      `known-${i}`,
      "settlement",
      "settlements",
      point({ ...p, x: p.x + offset }),
      { population: 10000 },
      `Known town ${i}`
    )
  );
  const before = structuredClone(towns);
  refinePlaces(state);
  expect(towns.map((t) => state.domain.world.features[t.id])).toEqual(before);
  const roads = Object.values(state.domain.world.features).filter((f) => f.kind === "road");
  expect(
    roads.every((f) => f.geometry.type === "LineString" && f.geometry.coordinates.length > 1)
  ).toBe(true);
});

it("moves the regional seat with a supplied river junction while retaining occupation and history", () => {
  for (const column of [7, 12]) {
    const { state } = regionalEnvironment(),
      g = state.surface,
      row = Math.floor(g.height / 2),
      junction = row * g.width + column;
    channel(state, "populationDensity", "people/square-kilometre", 100);
    channel(state, "flow", "cubic-metre/second", 30);
    g.channels.slope.fill(0.002);
    for (let x = 1; x < g.width - 1; x++) g.channels.riverOrder.set(row * g.width + x, 2);
    for (let y = 1; y < row; y++) g.channels.riverOrder.set(y * g.width + column, 1);
    const density = Array.from(g.channels.populationDensity),
      history = structuredClone(state.domain.world.epochs);
    refinePlaces(state);
    const node = Object.values(state.domain.world.features).find(
      (f) => f.kind === "settlement" && f.attributes.siteKind === "river-node"
    );
    const p = gridPosition(g, junction);
    expect(node?.geometry).toEqual(point(p));
    expect(node?.attributes.siteReason).toContain("junction");
    expect(Array.from(g.channels.populationDensity)).toEqual(density);
    expect(state.domain.world.epochs).toEqual(history);
  }
});

it("chooses a lake-shore terrace over its steep neighbor within the same site class", () => {
  for (const seed of [17, 73, 91]) {
    const { state } = regionalEnvironment(),
      g = state.surface,
      terrace = 3 * g.width + 7,
      hillside = terrace + 1;
    state.input.seed = seed;
    channel(state, "populationDensity", "people/square-kilometre", 0);
    g.channels.populationDensity.set(terrace, 100);
    g.channels.populationDensity.set(hillside, 100);
    g.channels.water.set(terrace + g.width, 2);
    g.channels.slope.set(terrace, 0.002);
    g.channels.slope.set(hillside, 0.07);
    const density = Array.from(g.channels.populationDensity);
    refinePlaces(state);
    const villages = Object.values(state.domain.world.features).filter(
      (f) => f.kind === "settlement"
    );
    expect(villages).toHaveLength(1);
    expect(villages[0].geometry).toEqual(point(gridPosition(g, terrace)));
    expect(villages[0].attributes.siteReason).toContain("lake shore");
    expect(Array.from(g.channels.populationDensity)).toEqual(density);
  }
});

it("uses located captured residents when their numerical density is absent, preserving explicit empty density", () => {
  for (const explicitEmpty of [false, true]) {
    const { state } = regionalEnvironment(),
      community: SocietyCommunity = {
        id: "occupied",
        name: "Occupied country",
        position: { x: 10000, y: 10000, z: 0 },
        footprint: state.surface.scope.footprint,
        areaKm2: 800,
        groups: [
          {
            people: "residents",
            culture: null,
            languages: [],
            religions: [],
            practices: [],
            count: 100000,
          },
        ],
        support: emptySupport(),
        founded: "",
        status: "inhabited",
        protected: false,
        causes: [],
      },
      society = {
        areaId: state.input.areaId,
        spaceId: state.surface.scope.spaceId,
        communities: [community],
        history: [],
        works: [],
        events: [],
        connections: [],
        magic: [],
      };
    state.domain.world.societies = { [state.input.areaId]: structuredClone(society) };
    if (explicitEmpty) channel(state, "populationDensity", "people/square-kilometre", 0);
    refinePlaces(state);
    const villages = Object.values(state.domain.world.features).filter(
      (f) => f.kind === "settlement"
    );
    if (explicitEmpty) expect(villages).toHaveLength(0);
    else expect(villages.length).toBeGreaterThan(1);
    expect(state.domain.world.societies[state.input.areaId]).toEqual(society);
  }
});
