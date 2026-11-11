import { gridPosition, residentBand, type SocietyCommunity } from "@atlas/domain";
import type { GenerationState } from "./process";
import { emptySupport } from "./societySupport";

/** Supplied residents and ownership for contracts; no settlement or population process runs. */
export function supplySociety(state: GenerationState) {
  const count = state.surface.active.length;
  const communities: SocietyCommunity[] = [1, 4, 7].map((cell, i) => ({
    id: `community-${i}`,
    name: `Community ${i}`,
    position: gridPosition(state.surface, Math.min(cell, count - 1)),
    areaKm2: 2,
    groups: [
      {
        people: "residents",
        culture: null,
        languages: [],
        religions: [],
        practices: [],
        count: 1000,
      },
    ],
    support: { ...emptySupport(), farming: 3000, capacity: 6000, water: 1 },
    founded: "Supplied history",
    status: "inhabited",
    protected: false,
    causes: [],
  }));
  state.society = {
    region: {
      areaId: state.domain.scope.areaId,
      spaceId: state.domain.scope.spaceId,
      communities,
      works: [],
      events: [],
      magic: [],
      history: [],
      connections: [],
    },
    owner: residentBand(
      "int32",
      Int32Array.from({ length: count }, (_, i) => Math.min(2, Math.floor((i * 3) / count)))
    ),
    river: residentBand("float64", new Float64Array(count)),
    coast: residentBand("float64", new Float64Array(count)),
    inherited: false,
    changed: new Set(),
    mediumChanged: new Set(),
  };
  return state.society;
}
