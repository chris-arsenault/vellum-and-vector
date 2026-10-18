import type { Area, Layer } from "./model";
import type { DomainSnapshot } from "./operations";
import type { Grid } from "./grids";
import { sample } from "./grids";
import { validateFieldTraits } from "./traits";
import { requireThat } from "./errors";
import { spatial } from "./spatial";
import { areaSpace, isDescendant } from "./composition";

export function fieldFact(layer: Layer, channel: string): string {
  return layer.id === channel || layer.facts?.includes(channel)
    ? channel
    : `${layer.id}.${channel}`;
}
export function validateAuthoredField(
  snapshot: DomainSnapshot,
  area: Area,
  grid: Grid,
  layer: Layer,
  descendants = true
): void {
  for (const channel of Object.keys(grid.channels)) {
    const fact = fieldFact(layer, channel);
    validateFieldTraits(area, grid, channel, fact);
    for (const candidate of Object.values(snapshot.world.areas))
      if (
        (candidate.id === area.id ||
          (descendants && isDescendant(snapshot.world.areas, candidate.id, area.id))) &&
        areaSpace(snapshot.world, candidate.id) === grid.scope.spaceId
      )
        validateFieldBoundary(snapshot, candidate, grid, channel, fact);
  }
}
function validateFieldBoundary(
  snapshot: DomainSnapshot,
  area: Area,
  grid: Grid,
  channel: string,
  fact: string
) {
  if (!area.boundary?.samples.length) return;
  const covers = spatial.pointCoverage(grid.scope.footprint);
  for (const edge of area.boundary?.samples ?? []) {
    if (!Object.hasOwn(edge.values, fact) || !covers(edge.point)) continue;
    requireThat(
      Math.abs(sample(grid, channel, edge.point) - edge.values[fact]) <=
        (snapshot.world.reference.precision ?? 1e-6),
      "locked_field_boundary",
      `Retain ${area.name}'s inherited ${fact} samples; reconcile the boundary to change them.`
    );
  }
}
