import { expect, it } from "vitest";
import { point } from "@atlas/domain";
import { generatedFeature } from "../mapFeatures";
import { addReach } from "../water/reachEvolution";
import { reachAt } from "../water/riverKeeping";
import { riverStorage } from "../water/riverStorage";
import { worldGeographyFixture } from "../world/worldGeographyFixtures";
import { Contributions } from "../coupling/fieldContributions";
import { positionOf } from "./lattice";
import { drawChannelsToSeats, knownSeats } from "./seats";
import type { RegionalWork } from "./state";

function supplied(attributes: Record<string, unknown> = {}) {
  const supplied = worldGeographyFixture([0, 0, 4000, 1000], Math.sqrt(4000000 / 32)),
    map = supplied.physical.map,
    count = map.mesh.count,
    regional: RegionalWork = {
      input: { areaId: "area", quality: "draft", seed: 73, domains: ["physical"] },
      parentSpan: map.mesh.spacing,
      inheritedHeight: map.coverage.copyBand(map.Elevation),
      natural: {},
      contributions: new Contributions(count),
      round: 0,
      network: {
        receiver: new Int32Array(count).fill(-1),
        order: new Int32Array(count),
        count,
        cost: new Float64Array(count),
        area: new Float64Array(count),
        flow: new Float64Array(count),
        inflow: new Float64Array(count),
        inflowCatchment: new Float64Array(count),
        level: new Float64Array(count),
        sea: new Uint8Array(count),
        base: new Float64Array(count),
        lake: new Int32Array(count).fill(-1),
        sink: new Uint8Array(count),
        bowl: new Uint8Array(count),
      },
    },
    state = Object.assign(supplied, { regional }),
    feature = {
      ...generatedFeature(
        state,
        "seat",
        "River town",
        "settlement",
        "settlements",
        point(positionOf(map.mesh, 0)),
        attributes
      ),
      placeId: "kept-town",
    };
  state.domain.world.features[feature.id] = feature;
  return { state, map, feature };
}

it("reads the source town's present geometry and recorded river-side relationship", () => {
  const { state, map, feature } = supplied({ situation: "river" }),
    present = map.mesh.count - 1,
    before = positionOf(map.mesh, 0);
  feature.geometry = point(positionOf(map.mesh, present));
  feature.attributes.sitedFrom = [before.x, before.y];
  expect(knownSeats(state)[0]).toMatchObject({ cell: present, situation: "river" });
});

it("recognizes a captured hosted river relationship even when the finer course is dry", () => {
  const { state } = supplied({ hostedBy: { host: "river", hostId: "source-river" } });
  expect(knownSeats(state)[0].situation).toBe("river");
});

it.each([
  [{ situation: "river" }, "seat-stream:kept-town"],
  [{ hostedBy: { host: "river", hostId: "source-river" } }, "source-river"],
] as const)(
  "submits the captured stream's dry course without a flow threshold: %s",
  (attributes, identity) => {
    const { state, map } = supplied(attributes),
      middle = map.mesh.neighbor(0, 0),
      end = Array.from({ length: map.mesh.degree(middle) }, (_, edge) =>
        map.mesh.neighbor(middle, edge)
      ).find((cell) => cell >= 0 && cell !== 0)!,
      receiving = addReach(riverStorage(map), [end]);
    receiving.river = "receiving-river";
    state.regional.network!.receiver[0] = middle;
    state.regional.network!.receiver[middle] = end;
    state.regional.evidence = {
      courses: [],
      lakes: [],
      entries: [],
      landmarks: [],
      seats: knownSeats(state),
    };
    drawChannelsToSeats(state);
    const kept = reachAt(map, 0);
    expect(kept).toMatchObject({
      river: identity,
      dry: true,
      downstream: receiving.id,
    });
    expect(kept?.cells).toEqual([0, middle]);
    expect(kept && Array.from(kept.monthly).every((flow) => flow === 0)).toBe(true);
  }
);

it("reuses an adjacent dry course without replacing its retained identity", () => {
  const { state, map } = supplied({ situation: "river" }),
    next = map.mesh.neighbor(0, 0),
    existing = addReach(riverStorage(map), [next]);
  existing.river = "existing-river";
  existing.dry = true;
  state.regional.evidence = {
    courses: [],
    lakes: [],
    entries: [],
    landmarks: [],
    seats: knownSeats(state),
  };
  drawChannelsToSeats(state);
  expect(map.rivers.reaches.size).toBe(1);
  expect(reachAt(map, next)).toBe(existing);
  expect(existing.river).toBe("existing-river");
  expect(existing.monthly.every((flow) => flow === 0)).toBe(true);
});
