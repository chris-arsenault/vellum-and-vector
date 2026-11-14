import {
  areaSpace,
  requireThat,
  type DomainSnapshot,
  type FieldRef,
  type GridSurface,
} from "@atlas/domain";
import { authoredFields } from "./mapAuthored";

function reference(source: DomainSnapshot, field: FieldRef, names: string[]) {
  requireThat(field.resourceId, "missing_field", "Generation reads completed numerical resources.");
  return {
    resourceId: field.resourceId,
    channels: names,
    overlays: source.fieldPatches
      .filter((patch) => patch.fieldId === field.id && !patch.mapOnly)
      .map((patch) => {
        const channels = patch.channels.filter((name) => names.includes(name));
        return {
          footprint: patch.footprint,
          channels,
          source: { resourceId: patch.resourceId, channels, overlays: [] },
        };
      })
      .filter((overlay) => overlay.channels.length),
  };
}
export function rustCapturedFields(source: DomainSnapshot) {
  return source.world.fields.flatMap((field) => {
    const grid = source.numerical[field.id];
    if (!grid) return [];
    return [
      {
        area: field.areaId,
        space: grid.scope.spaceId,
        input: !!field.input,
        resolution: grid.scope.resolution,
        footprint: grid.scope.footprint,
        source: reference(source, field, Object.keys(grid.channels)),
      },
    ];
  });
}
export function rustAuthoredFields(source: DomainSnapshot) {
  return authoredFields(source).map((authority) => {
    const grid = authority.source;
    requireThat(
      grid,
      "authored_field_input",
      "Load the effective sampled field for every authored patch in the generation extent."
    );
    return {
      space: authority.spaceId ?? null,
      footprint: authority.footprint ?? grid.scope.footprint,
      sourceFootprint: grid.scope.footprint,
      channels: authority.channels ?? Object.keys(grid.channels),
      source: authoredReference(source, grid),
    };
  });
}
function authoredReference(source: DomainSnapshot, grid: GridSurface) {
  const field = source.world.fields.find((field) => source.numerical[field.id] === grid);
  if (field) return reference(source, field, Object.keys(grid.channels));
  const patch = source.fieldPatches.find((patch) => source.numerical[patch.resourceId] === grid);
  requireThat(
    patch,
    "authored_field_input",
    "Authored inputs retain their completed resource reference."
  );
  return { resourceId: patch.resourceId, channels: Object.keys(grid.channels), overlays: [] };
}
export function rustAreaContext(source: DomainSnapshot) {
  const ancestors: string[] = [];
  for (
    let id = source.world.areas[source.scope.areaId].parentId;
    id;
    id = source.world.areas[id].parentId
  ) {
    requireThat(!ancestors.includes(id), "area_cycle", "Geographic ancestry contains a cycle.");
    ancestors.push(id);
  }
  return {
    ancestors,
    areaSpaces: Object.fromEntries(
      Object.keys(source.world.areas).map((id) => [id, areaSpace(source.world, id)])
    ),
  };
}
