import type { DomainSnapshot } from "./operations";
import type { GridSurface } from "./grids";

function copyFieldRecords(grid: GridSurface): GridSurface {
  const copy: GridSurface = {
    ...grid,
    channels: { ...grid.channels },
    units: { ...grid.units },
  };
  if (grid.quantities) copy.quantities = { ...grid.quantities };
  if (grid.prepared) {
    copy.prepared = {
      ...grid.prepared,
      coefficients: { ...grid.prepared.coefficients },
      transforms: { ...grid.prepared.transforms },
    };
    if (grid.prepared.adaptive) copy.prepared.adaptive = { ...grid.prepared.adaptive };
  }
  if (grid.geography) copy.geography = copyGeography(grid.geography);
  if (grid.overlays)
    copy.overlays = grid.overlays.map((overlay) => ({
      ...overlay,
      channels: [...overlay.channels],
      grid: copyFieldRecords(overlay.grid),
    }));
  return copy;
}
function copyGeography(geography: NonNullable<GridSurface["geography"]>) {
  const copy = { ...geography };
  if (geography.provinces) copy.provinces = { ...geography.provinces };
  if (geography.categories) copy.categories = { ...geography.categories };
  if (geography.occurrences) copy.occurrences = { ...geography.occurrences };
  if (geography.water) copy.water = { ...geography.water, lakes: [...geography.water.lakes] };
  if (geography.biome)
    copy.biome = {
      ...geography.biome,
      values: { ...geography.biome.values },
      prepared: { ...geography.biome.prepared },
      codes: [...geography.biome.codes],
    };
  return copy;
}

/** Numerical resources are immutable inputs. Copy mutable records, share their typed data. */
export function cloneSnapshot(source: DomainSnapshot): DomainSnapshot {
  const authored = new Set([
    ...source.world.fields
      .filter((field) => ["authored", "protected"].includes(field.state ?? ""))
      .map((field) => field.id),
    ...source.fieldPatches.map((patch) => patch.resourceId),
  ]);
  const numerical = Object.fromEntries(
    Object.entries(source.numerical).map(([id, grid]) => [
      id,
      authored.has(id) ? structuredClone(grid) : copyFieldRecords(grid),
    ])
  );
  return { ...structuredClone({ ...source, numerical: {} }), numerical };
}
