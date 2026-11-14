import { requireThat, type Grid, type FieldGeography } from "@atlas/domain";
import type { RustCompleted } from "./rustApplication";

interface SurfaceReader {
  load(id: string, channels: string[], geography: FieldGeography): Promise<Grid>;
}

/** Reopen completed local chunks through the same reader used for saved generation inputs. */
export async function rustGenerationSurface(
  fields: SurfaceReader,
  result: RustCompleted
): Promise<Grid> {
  const geography = result.geography[0];
  requireThat(geography, "field_geography", "Completed generation retains its field geography.");
  const initial = result.fields.find((field) => field.resourceId === result.surfaceResourceId),
    surface = await fields.load(result.surfaceResourceId, initial?.channels ?? [], geography);
  surface.id = result.surfaceId;
  for (const field of result.fields) {
    if (field.resourceId === result.surfaceResourceId) continue;
    const grid = await fields.load(field.resourceId, field.channels, geography);
    Object.assign(surface.channels, grid.channels);
    Object.assign(surface.units, grid.units);
    Object.assign((surface.quantities ??= {}), grid.quantities);
    if (grid.materialCargo) surface.materialCargo = grid.materialCargo;
  }
  return surface;
}
