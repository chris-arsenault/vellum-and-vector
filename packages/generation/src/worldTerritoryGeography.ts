import {
  fieldInterpolator,
  fieldContour,
  contourSupport,
  gridCellBounds,
  population,
  spatial,
  type SocietyCommunity,
  type Bounds,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState } from "./process";
import { SocietySpread } from "./societyTraversal";
import { dryLand } from "./societySupport";
import { nearestSocietySample } from "./societySpatial";
import { profileOf } from "./societyProfile";
import { areaGeometry } from "./canonry/geographicContours";

type Meaning = "sovereignty" | "control" | "claim";
/** Travel budget grows with supported population, independently of ownership-cell area. */
const hinterlandMetresPerRootResident = 1_000;
function hinterlandBudget(state: GenerationState, community: SocietyCommunity, control: boolean) {
  const residents = control
    ? Math.min(population(community), community.support.capacity)
    : community.support.capacity;
  if (control && community.status !== "inhabited") return 0;
  const political = state.society!.region.politics!,
    id = political.control[community.id],
    health = control ? (political.polities.find((p) => p.id === id)?.support ?? 1) : 1;
  return (
    Math.sqrt(Math.max(0, residents)) *
    hinterlandMetresPerRootResident *
    Math.max(0, health) *
    profileOf(state).politicalReach
  );
}
function territoryGroups(state: GenerationState, meaning: Meaning) {
  const region = state.society!.region,
    politics = region.politics!;
  if (meaning === "claim")
    return politics.polities.map((p) => ({
      id: p.id,
      communities: region.communities.filter((c) => p.claims.includes(c.id)),
    }));
  const assignment = politics[meaning],
    groups = new Map<string, SocietyCommunity[]>();
  for (const c of region.communities) {
    const id = assignment[c.id] ?? "",
      members = groups.get(id) ?? [];
    members.push(c);
    groups.set(id, members);
  }
  return [...groups].map(([id, communities]) => ({ id, communities }));
}
/** A bounded cost expansion visits a territory and its interpolation collar, not the world per polygon. */
function costDomain(state: GenerationState, communities: SocietyCommunity[], control: boolean) {
  const grid = state.surface,
    seeds = communities
      .map((c) => ({ c, cell: nearestSocietySample(grid, c.position, (i) => dryLand(state, i)) }))
      .filter((s) => s.cell >= 0),
    spacing = seeds.reduce((size, s) => {
      const b = gridCellBounds(grid, s.cell);
      return Math.max(size, b[2] - b[0], b[3] - b[1]);
    }, 1),
    collar = spacing * 3,
    spread = new SocietySpread(state, false, collar * 10),
    cells: number[] = [],
    bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { c, cell } of seeds) {
    const budget = hinterlandBudget(state, c, control);
    if (budget > 0) spread.seed(cell, 0, -budget);
  }
  spread.run(collar, (i) => {
    if (spread.distances.get(i) > 0) return;
    cells.push(i);
    const b = gridCellBounds(grid, i);
    for (let axis = 0; axis < 4; axis++)
      bounds[axis] = axis < 2 ? Math.min(bounds[axis], b[axis]) : Math.max(bounds[axis], b[axis]);
  });
  const at = fieldInterpolator(
    { ...grid, overlays: [], channels: { cost: spread.distances } },
    "cost"
  );
  return {
    cells,
    bounds,
    at,
    close() {
      grid.coverage.release(spread.owner);
      grid.coverage.release(spread.distances);
    },
  };
}
/** Continuous cost differences locate shared frontiers; zero support leaves country unclaimed. */
export function worldTerritories(state: GenerationState, meaning: Meaning = "sovereignty") {
  const grid = state.surface,
    domains = territoryGroups(state, meaning).map((group) => ({
      id: group.id,
      ...costDomain(state, group.communities, meaning === "control"),
    }));
  return {
    shape(id: string) {
      const own = domains.find((domain) => domain.id === id);
      if (!own?.cells.length) return null;
      const competitors =
        meaning === "claim"
          ? []
          : domains.filter(
              (other) => other !== own && other.cells.length && overlaps(own.bounds, other.bounds)
            );
      const at = (x: number, y: number) => {
        const p = { x, y, z: 0 },
          cost = own.at(p);
        return Math.min(0, ...competitors.map((other) => other.at(p))) - cost;
      };
      const shape = fieldContour(
        grid.topology ?? grid,
        at,
        grid.topology ? contourSupport(grid.topology, own.cells) : undefined,
        0,
        undefined,
        state.contours
      );
      return shape && clipTerritoryWater(state, shape);
    },
    close() {
      for (const domain of domains) domain.close();
    },
  };
}
function overlaps(a: Bounds, b: Bounds) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
function clipTerritoryWater(state: GenerationState, shape: Geometry) {
  let clipped = spatial.intersection(shape, state.domain.scope.footprint);
  if (clipped && state.surface.ocean) clipped = spatial.difference(clipped, state.surface.ocean);
  for (const lake of state.surface.lakes ?? [])
    if (clipped && spatial.intersects(clipped, lake.geometry))
      clipped = spatial.difference(clipped, lake.geometry);
  return areaGeometry(clipped);
}
