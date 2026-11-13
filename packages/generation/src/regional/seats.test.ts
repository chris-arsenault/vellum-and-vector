import { expect, it } from "vitest";
import { point } from "@atlas/domain";
import { generatedFeature } from "../mapFeatures";
import { landscape } from "../mapFixtures";
import { createTestField } from "../rock/groundTestFixture";
import { addReach } from "../water/reachEvolution";
import { reachAt } from "../water/riverKeeping";
import { createWorldMesh } from "../world/worldMesh";
import { positionOf } from "./lattice";
import { drawChannelsToSeats, knownSeats } from "./seats";
import type { RegionalState } from "./state";

function supplied(attributes: Record<string, unknown> = {}) {
  const base = landscape();
  base.domain.world.id = crypto.randomUUID();
  base.domain.scope.worldId = base.domain.world.id;
  const map = createTestField(createWorldMesh([0, 0, 4000, 1000], 32, 0)),
    state = {
      ...base,
      physical: { map },
      regional: {
        input: { areaId: "area" },
        parentSpan: map.mesh.spacing,
        network: {
          receiver: new Int32Array(map.mesh.count).fill(-1),
          flow: new Float64Array(map.mesh.count),
        },
      },
    } as unknown as RegionalState,
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
      receiving = addReach(map.rivers, [end]);
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
    expect(kept?.monthly.every((flow) => flow === 0)).toBe(true);
  }
);

it("reuses an adjacent dry course without replacing its retained identity", () => {
  const { state, map } = supplied({ situation: "river" }),
    next = map.mesh.neighbor(0, 0),
    existing = addReach(map.rivers, [next]);
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
