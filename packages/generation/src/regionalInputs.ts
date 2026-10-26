import {
  areaSpace,
  isDescendant,
  spatial,
  type DomainSnapshot,
  type Grid,
  type Diagnostic,
} from "@atlas/domain";
import { generationResolution } from "./resolution";

/** Ancestors only: a neighboring or descendant map cannot become its own procedural input. */
export function regionalInputFields(source: DomainSnapshot, areaId: string, omitSelf = true) {
  const area = source.world.areas[areaId],
    space = areaSpace(source.world, areaId);
  return source.world.fields
    .filter((field) => {
      const grid = source.numerical[field.id];
      return (
        grid &&
        grid.scope.spaceId === space &&
        (!omitSelf || field.areaId !== areaId) &&
        isDescendant(source.world.areas, areaId, field.areaId) &&
        spatial.covers(grid.scope.footprint, area.footprint)
      );
    })
    .map((field) => source.numerical[field.id])
    .sort((a, b) => (b.scope.resolution ?? Infinity) - (a.scope.resolution ?? Infinity));
}
/** Each channel has one finest applicable input; do not let field insertion order pick it. */
export function regionalInputChannels(fields: Grid[]) {
  const result = new Map<string, Grid>();
  for (const grid of fields) for (const name of Object.keys(grid.channels)) result.set(name, grid);
  return result;
}
export function regionalInputDiagnostics(source: DomainSnapshot, areaId: string): Diagnostic[] {
  const area = source.world.areas[areaId];
  if (!area.parentId || area.profile !== "region") return [];
  if (regionalInputFields(source, areaId).some((field) => field.channels.elevation)) return [];
  return [
    {
      code: "regional_parent",
      severity: "error",
      invocation: null,
      resource: areaId,
      message:
        "Generate or supply terrain on the parent map before refining this region. Region selection remains available without generation.",
    },
  ];
}
/** Linear refinement per quality; hierarchy depth and named administrative ranks are irrelevant. */
const regionalSubdivision = { draft: 2, standard: 4, fine: 8 };
const regionInteriorSamples = 8;
export function regionalResolution(source: DomainSnapshot, areaId: string, quality: string) {
  const area = source.world.areas[areaId],
    base = generationResolution(quality, area.profile);
  if (!area.parentId) return base;
  const parent = regionalInputChannels(regionalInputFields(source, areaId)).get("elevation"),
    parentSpan = parent?.scope.resolution ?? base.cellSpan * 4,
    footprintWidth = (2 * spatial.area(area.footprint)) / spatial.length(area.footprint),
    factor = regionalSubdivision[quality as keyof typeof regionalSubdivision],
    cellSpan = Math.min(base.cellSpan, parentSpan / factor, footprintWidth / regionInteriorSamples);
  return { cellSpan, cellArea: cellSpan ** 2, cellAreaKm2: cellSpan ** 2 / 1e6 };
}
