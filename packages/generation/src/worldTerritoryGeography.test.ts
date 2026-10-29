import { expect, it } from "vitest";
import { spatial, gridPosition, point, rectangle } from "@atlas/domain";
import { worldPoliticsFixture } from "./worldPoliticsFixtures";
import { initializePolitics } from "./societyPolitics";
import { publishPolitics } from "./societyPoliticalPublication";
import { worldGeographyFixture } from "./canonry/worldGeographyFixtures";
import { publishPoliticalRegions } from "./worldPoliticalRegions";
import { generatedFeature } from "./mapFeatures";
import { nearestSocietySample } from "./societySpatial";
import { atlasPublicationDefinitions } from "./canonry/atlasPublications";
import { publishGenerationProducts } from "./publication";
import { worldTerritories } from "./worldTerritoryGeography";

it("gives competing countries the same geographic frontier", () => {
  const { state, context, communities } = worldPoliticsFixture();
  for (const c of communities) {
    c.position = gridPosition(state.surface, nearestSocietySample(state.surface, c.position));
    c.support.capacity = 40_000;
  }
  state.domain.world.entities.country.attributes.center = communities[0].position;
  state.domain.world.entities.east = {
    ...state.domain.world.entities.country,
    id: "east",
    name: "East",
    attributes: { center: communities[1].position },
  };
  initializePolitics(state, context);
  publishPolitics(state);
  const countries = Object.values(state.domain.world.features).filter(
    (f) => f.kind === "sovereignty"
  );
  expect(countries).toHaveLength(2);
  const common = spatial.intersection(countries[0].geometry, countries[1].geometry);
  expect(common).not.toBeNull();
  expect(common!.type).toMatch(/LineString/);
  expect(spatial.bounds(common!)[0]).toBeCloseTo(
    (communities[0].position.x + communities[1].position.x) / 2,
    0
  );
});

it("divides a continental territory into geographic parts without creating sovereign entities", () => {
  const state = worldGeographyFixture([0, 0, 2_000_000, 1_000_000], 100_000),
    parent = generatedFeature(
      state,
      "country",
      "Country",
      "sovereignty",
      "sovereignty",
      state.domain.scope.footprint
    );
  parent.relations = [{ kind: "sovereign", targetId: "existing-polity" }];
  const entities = structuredClone(state.domain.world.entities);
  publishPoliticalRegions(state, parent);
  const parts = Object.values(state.domain.world.features);
  expect(parts.length).toBeGreaterThan(1);
  expect(
    parts.every((f) => f.kind === "politicalRegion" && f.attributes.parentTerritory === parent.id)
  ).toBe(true);
  expect(parts.every((f) => f.relations.some((r) => r.targetId === "existing-polity"))).toBe(true);
  expect(new Set(parts.map((f) => f.name)).size).toBe(parts.length);
  expect(parts.every((f) => f.name.endsWith(" Province"))).toBe(true);
  expect(parts.every((f) => spatial.area(f.geometry) > 100e9)).toBe(true);
  expect(state.domain.world.entities).toEqual(entities);
  state.surface.channels = {};
  state.publications = atlasPublicationDefinitions({
    areaId: "area",
    seed: 42,
    quality: "draft",
    domains: ["political"],
  });
  expect(() => publishGenerationProducts(state, "continental-parts")).not.toThrow();
});

it("clips a World claim to its map and physical water while retaining disconnected possessions", () => {
  const { state, context, communities, region } = worldPoliticsFixture();
  initializePolitics(state, context);
  region.politics!.polities[0].claims.push("c2");
  const footprint = rectangle([20_000, 50_000, 580_000, 350_000]),
    water = rectangle([60_000, 180_000, 70_000, 220_000]);
  state.domain.scope.footprint = footprint;
  state.surface.ocean = water;
  const claims = worldTerritories(state, "claim"),
    shape = claims.shape("country")!;
  claims.close();
  expect(shape.type).toBe("MultiPolygon");
  expect(spatial.covers(footprint, shape)).toBe(true);
  expect(spatial.intersection(water, shape)?.type.includes("Polygon") ?? false).toBe(false);
  for (const community of communities)
    expect(spatial.covers(shape, point(community.position))).toBe(true);
  expect(spatial.covers(shape, point({ x: 350_000, y: 200_000, z: 0 }))).toBe(false);
});
