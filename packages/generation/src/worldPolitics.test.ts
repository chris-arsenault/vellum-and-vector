import { expect, it } from "vitest";
import { worldPoliticsFixture } from "./worldPoliticsFixtures";
import { initializePolitics, evolvePolitics } from "./societyPolitics";
import { gridPosition, point, spatial } from "@atlas/domain";
import { publishPolitics } from "./societyPoliticalPublication";
import { worldTerritories } from "./worldTerritoryGeography";
import { generatedFeature } from "./mapFeatures";

it("leaves unreachable communities outside founding claims without changing their population", () => {
  const { state, context, communities, region } = worldPoliticsFixture(),
    residents = structuredClone(communities.map((c) => c.groups));
  initializePolitics(state, context);
  expect(region.politics!.polities[0].claims).toEqual(["c0", "c1"]);
  expect(region.politics!.sovereignty.c2).toBeUndefined();
  expect(communities.map((c) => c.groups)).toEqual(residents);
});

it("allows a supported small institutional state while retaining its parent's claim", () => {
  const { state, context, region } = worldPoliticsFixture();
  initializePolitics(state, context);
  const institution = generatedFeature(
    state,
    "assembly",
    "Assembly",
    "institution",
    "institutions",
    point(region.communities[1].position),
    { communityId: "c1" }
  );
  state.domain.world.features[institution.id] = institution;
  region.connections = [];
  context.epochs = [
    { id: "Loss", duration: 200, parentEpoch: null, variables: { politicalCapacity: 0 } },
  ];
  evolvePolitics(state, context, 150);
  expect(region.politics!.polities).toHaveLength(2);
  expect(region.politics!.polities[1].seat).toBe("c1");
  expect(region.politics!.polities[0].claims).toContain("c1");
});

it("leaves unsupported hinterland open and responds to a terrain barrier with population fixed", () => {
  const { state, context, communities } = worldPoliticsFixture();
  initializePolitics(state, context);
  const plain = worldTerritories(state),
    before = plain.shape("country")!;
  plain.close();
  expect(spatial.intersects(before, point({ x: 50_000, y: 200_000, z: 0 }))).toBe(true);
  expect(spatial.intersects(before, point({ x: 50_000, y: 390_000, z: 0 }))).toBe(false);
  const mountain = point({ x: 100_000, y: 200_000, z: 0 });
  expect(spatial.intersects(before, mountain)).toBe(true);
  const residents = structuredClone(communities.map((c) => c.groups));
  for (let i = 0; i < state.surface.active.length; i++) {
    const p = gridPosition(state.surface, i);
    if (p.x > 75_000 && p.x < 130_000) state.surface.channels.elevation.set(i, 3_000);
  }
  const barrier = worldTerritories(state),
    after = barrier.shape("country")!;
  barrier.close();
  // The added 2,900 m climb costs 87 km, exceeding the community's 77 km budget.
  expect(spatial.intersects(after, mountain)).toBe(false);
  expect(spatial.intersects(after, point(communities[0].position))).toBe(true);
  expect(spatial.intersects(after, point(communities[1].position))).toBe(true);
  expect(spatial.area(after)).toBeLessThan(spatial.area(before));
  expect(communities.map((c) => c.groups)).toEqual(residents);
});

it("retains a claim after control loses its connecting route", () => {
  const { state, context, region, communities } = worldPoliticsFixture();
  initializePolitics(state, context);
  region.connections = [];
  evolvePolitics(state, context, 10);
  publishPolitics(state);
  const features = Object.values(state.domain.world.features),
    claim = features.find((f) => f.kind === "claim")!,
    control = features.find((f) => f.kind === "control")!;
  expect(spatial.intersects(claim.geometry, point(communities[1].position))).toBe(true);
  expect(spatial.intersects(control.geometry, point(communities[1].position))).toBe(false);
  expect(region.politics!.polities[0].claims).toEqual(["c0", "c1"]);
});
it("does not turn a small unsupported community into a successor during lost control", () => {
  const { state, context, communities, region } = worldPoliticsFixture();
  initializePolitics(state, context);
  region.politics!.sovereignty.c2 = "country";
  region.politics!.polities[0].claims.push("c2");
  communities[2].groups[0].count = 200;
  context.epochs = [
    { id: "Loss", duration: 200, parentEpoch: null, variables: { politicalCapacity: 0 } },
  ];
  region.connections = [];
  evolvePolitics(state, context, 150);
  expect(region.politics!.polities).toHaveLength(1);
  expect(region.politics!.polities[0].claims).toContain("c2");
});
