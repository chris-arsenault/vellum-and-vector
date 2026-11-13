import { expect, it } from "vitest";
import { point, type AtlasFeature } from "@atlas/domain";
import { capturedPlace } from "../poi/poiPublish";
import type { RegionalState } from "../regional/state";
import { addReach } from "../water/reachEvolution";
import { nativePosition } from "../world/atlasWorkspace";
import { worldGeographyFixture } from "../world/worldGeographyFixtures";
import { hostedCell, linkOn } from "./areaHosting";
import { river } from "./river";

function suppliedFragments() {
  const supplied = worldGeographyFixture([0, 0, 8000, 8000], 1000),
    state = Object.assign(supplied, { regional: { input: { areaId: "area" } } }) as RegionalState,
    map = state.physical.map,
    first = 0,
    last = map.mesh.count - 1;
  for (const cell of [first, last]) {
    const reach = addReach(map.rivers, [cell]);
    reach.river = "host-river";
    reach.drawn = true;
    reach.monthly.fill(20);
  }
  return { state, first, last };
}
function place(state: RegionalState, cell: number): AtlasFeature {
  return {
    id: "carried-place",
    name: "Captured Fall",
    kind: "waterfall",
    layerId: "landmarks",
    areaId: "area",
    geometry: point(nativePosition(state.physical, cell)),
    attributes: { hostedBy: { host: "river", hostId: "host-river" } },
    state: "generated",
    protected: false,
    detail: {},
    relations: [],
    actor: "generator",
    generationId: null,
    causes: [],
  };
}

it("records river identity without a second positional representation", () => {
  const { state, last } = suppliedFragments();
  expect(linkOn(state, "river", last)).toEqual({ host: "river", hostId: "host-river" });
});

it("locates each captured position on its actual disconnected host cells", () => {
  const { state, first, last } = suppliedFragments(),
    earlier = place(state, first),
    current = place(state, last);
  current.attributes.capturedRecord = earlier;
  expect(hostedCell(state, earlier)).toBe(first);
  expect(hostedCell(state, current)).toBe(last);
  const middle = place(state, Math.floor(state.physical.map.mesh.count / 2));
  expect([first, last]).toContain(hostedCell(state, middle));
});

it("reads the pinned parent place rather than a mutable product or ancestral record", () => {
  const { state, first, last } = suppliedFragments(),
    captured = place(state, last),
    changed = place(state, first);
  captured.attributes.capturedRecord = changed;
  state.sourceFeatures = { get: () => captured, values: () => [captured] };
  expect(capturedPlace(state, changed)).toBe(captured);
  expect(hostedCell(state, capturedPlace(state, changed))).toBe(last);
});

it("locates a canonical source position in the host map's continuous chart", () => {
  const { state, last } = suppliedFragments(),
    feature = place(state, last),
    position = nativePosition(state.physical, last);
  state.surface.periodicWidth = 8000;
  feature.geometry = point({ ...position, x: position.x + state.surface.periodicWidth });
  expect(hostedCell(state, feature)).toBe(last);
});

it("retains an established host on a dry course while new-place siting still reads running water", () => {
  const { state, first, last } = suppliedFragments(),
    map = state.physical.map;
  for (const reach of map.rivers.reaches.values()) {
    reach.dry = true;
    reach.monthly.fill(0);
  }
  expect(hostedCell(state, place(state, first))).toBe(first);
  expect(hostedCell(state, place(state, last))).toBe(last);
  expect(linkOn(state, "river", last)).toBeNull();
});

it("keeps a losing river's dry tail available as an established host", () => {
  const { state, first } = suppliedFragments(),
    map = state.physical.map,
    tail = map.mesh.neighbor(first, 0),
    reach = addReach(map.rivers, [first, tail]);
  reach.river = "host-river";
  reach.drawn = true;
  reach.monthly.fill(20, 0, 12);
  expect(hostedCell(state, place(state, tail))).toBe(tail);
});

function adoptionInputs() {
  const { state, first, last } = suppliedFragments(),
    source = {
      ...place(state, first),
      id: "source",
      areaId: "area",
      name: "Current River",
      attributes: { riverId: "host-river", capturedCourse: { sourceId: "ancestor" } },
    },
    other = {
      ...place(state, last),
      id: "other",
      areaId: "area",
      name: "Other fragment",
      attributes: { riverId: "host-river" },
    },
    developed = {
      ...place(state, last),
      id: "developed",
      areaId: "area",
      attributes: { riverId: "host-river", developedBy: "regional" },
    };
  for (const feature of [source, other, developed]) {
    feature.kind = "river";
    feature.layerId = "rivers";
    const p = nativePosition(state.physical, first),
      q = nativePosition(state.physical, state.physical.map.mesh.neighbor(first, 0));
    feature.geometry = {
      type: "LineString",
      coordinates: [
        [p.x, p.y],
        [q.x, q.y],
      ],
    };
    state.domain.world.features[feature.id] = feature;
  }
  state.regional.evidence = {
    courses: [
      {
        feature: source,
        cells: Int32Array.of(first),
        discharge: 10,
        order: 1,
        carried: { sourceId: "ancestor", geometry: source.geometry, discharge: 10, order: 1 },
      },
    ],
  } as RegionalState["regional"]["evidence"];
  const adopt = river.lineage.adopt;
  if (typeof adopt !== "function") throw new Error("River adoption is required");
  return { state, source, other, developed, adopt };
}

it("replaces captured fragments with developed records without changing another captured fragment", () => {
  const { state, adopt } = adoptionInputs();
  adopt(state);
  expect(state.domain.world.features.source).toBeUndefined();
  expect(state.domain.world.features.other.name).toBe("Other fragment");
  expect(state.domain.world.features.developed.name).toBe("Current River");
});

const protectedStates: readonly Partial<AtlasFeature>[] = [
  { protected: true },
  { state: "authored" },
  { state: "protected" },
  {
    detail: {
      area: {
        id: "authored-detail",
        geometry: point({ x: 0, y: 0, z: 0 }),
        state: "authored",
        protected: false,
        needsReconciliation: false,
        attributes: {},
        actor: "creator",
        generationId: null,
      },
    },
  },
];

it.each(protectedStates)(
  "preserves a source record held by existing publication policy: %j",
  (held) => {
    const { state, source, adopt } = adoptionInputs();
    Object.assign(source, held);
    const previous = structuredClone(source);
    adopt(state);
    expect(state.domain.world.features.source).toEqual(previous);
    expect(state.domain.world.features.developed.name).toBe("Current River");
  }
);

it.each(protectedStates)(
  "does not adopt an old developed record held by publication policy: %j",
  (held) => {
    const { state, source, developed, adopt } = adoptionInputs();
    Object.assign(developed, held);
    const previous = structuredClone(developed);
    adopt(state);
    expect(state.domain.world.features.developed).toEqual(previous);
    expect(state.domain.world.features.source).toBe(source);
  }
);
