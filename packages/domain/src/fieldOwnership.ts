import type { Grid } from "./grids";
import type { Area, Layer } from "./model";
import { profiles } from "./model";
import type { DomainSnapshot } from "./operations";
import { validateCoverage, type MaterializedCoverage } from "./coverage";
import { semanticId } from "./identity";
import { spatial } from "./spatial";
import { requireThat } from "./errors";

export function authoredFieldCoverage(
  snapshot: DomainSnapshot,
  area: Area,
  layer: Layer,
  field: string,
  grid: Grid
): MaterializedCoverage {
  for (const previous of snapshot.world.fields.filter(
    (f) => f.id !== field && f.areaId === area.id && f.layerId === layer.id
  )) {
    if (!previous.channels?.some((c) => Object.hasOwn(grid.channels, c))) continue;
    const overlap = previous.footprint
      ? spatial.intersection(previous.footprint, grid.scope.footprint)
      : grid.scope.footprint;
    requireThat(
      !overlap || spatial.area(overlap) === 0,
      "field_authority",
      "An existing field owns these channels in this area; sculpt its sampled values or refine it in a finer area."
    );
  }
  const coverage: MaterializedCoverage = {
    id: semanticId(snapshot.world.id, "field-coverage", field),
    areaId: area.id,
    spaceId: grid.scope.spaceId,
    layerId: layer.id,
    detailRank: profiles.indexOf(area.profile),
    resolution: grid.scope.resolution,
    time: grid.scope.time,
    footprint: grid.scope.footprint,
    state: "authored",
    resourceId: grid.id,
    generationId: null,
  };
  validateCoverage(snapshot.world, coverage, snapshot.coverage);
  return coverage;
}
