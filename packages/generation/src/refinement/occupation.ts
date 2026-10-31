import { canonicalPosition, gridPosition, population, spatial } from "@atlas/domain";
import { channel, type RefinementState } from "./state";

/** Present located residents can supply a missing projection; an explicit field remains authoritative. */
export function regionalOccupation(state: RefinementState) {
  if (state.surface.channels.populationDensity) return;
  const communities =
    state.domain.world.societies?.[state.input.areaId]?.communities.filter(
      (c) => c.footprint && c.areaKm2 > 0 && population(c) > 0
    ) ?? [];
  if (!communities.length) return;
  const g = state.surface,
    density = channel(state, "populationDensity", "people/square-kilometre"),
    footprints = communities.map((c) => c.footprint!),
    coverage = footprints.map((shape) => spatial.pointCoverage(shape));
  spatial.withIndex(footprints, (index) => {
    for (let i = 0; i < g.active.length; i++) {
      const p = canonicalPosition(state.domain.world.reference, gridPosition(g, i));
      for (const k of index.query([p.x, p.y, p.x, p.y]))
        if (coverage[k](p)) density.add(i, population(communities[k]) / communities[k].areaKm2);
    }
  });
}
