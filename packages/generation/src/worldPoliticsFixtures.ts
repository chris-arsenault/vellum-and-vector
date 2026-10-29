import { putChannel, residentBand, type SocietyCommunity } from "@atlas/domain";
import { worldGeographyFixture } from "./canonry/worldGeographyFixtures";
import { emptySupport } from "./societySupport";
import type { MapProcessContext } from "./process";

/** Supplied communities, terrain and contact graph; no population or physical generation. */
export function worldPoliticsFixture() {
  const state = worldGeographyFixture(),
    n = state.surface.active.length;
  putChannel(
    state.surface,
    "elevation",
    "metre",
    residentBand("float64", new Float64Array(n).fill(100))
  );
  const communities: SocietyCommunity[] = [50_000, 200_000, 550_000].map((x, i) => ({
    id: `c${i}`,
    name: `Community ${i}`,
    position: { x, y: 200_000, z: 0 },
    areaKm2: 2_000,
    groups: [
      {
        people: "people",
        culture: null,
        languages: [],
        religions: [],
        practices: [],
        count: 3_000,
      },
    ],
    support: { ...emptySupport(), capacity: 6_000 },
    founded: "Founding",
    status: "inhabited",
    protected: false,
    causes: [],
  }));
  state.society = {
    region: {
      areaId: "area",
      spaceId: "surface",
      communities,
      works: [],
      events: [],
      magic: [],
      history: [],
      connections: [{ from: "c0", to: "c1", distance: 150_000, travelCost: 150_000, kind: "land" }],
    },
    owner: residentBand("int32", new Int32Array(n)),
    river: residentBand("float64", new Float64Array(n)),
    coast: residentBand("float64", new Float64Array(n)),
    inherited: false,
    changed: new Set(),
    mediumChanged: new Set(),
  };
  state.domain.world.entities.country = {
    id: "country",
    name: "Country",
    kind: "polity",
    state: "generated",
    attributes: { center: communities[0].position },
    relations: [],
  };
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: { polityCount: 1 },
    epochs: [],
    epochIndices: [],
    causes: [],
    recordCause() {},
    progress() {},
    random: () => 0.5,
    cancelled: () => false,
  };
  return { state, context, communities, region: state.society.region };
}
