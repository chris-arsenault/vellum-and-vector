import type { DomainSnapshot } from "./operations";
import { copyGrid } from "./gridCopy";
import type { GridSurface } from "./grids";
import { Band } from "./lattice/band";

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
      authored.has(id) && !immutableSamples(grid)
        ? copyGrid(grid)
        : immutableSamples(grid)
          ? shareInputs(grid)
          : {
              ...grid,
              channels: { ...grid.channels },
              units: { ...grid.units },
              ...(grid.quantities ? { quantities: { ...grid.quantities } } : {}),
              overlays: grid.overlays?.map((overlay) => ({
                ...overlay,
                channels: [...overlay.channels],
                grid: immutableSamples(overlay.grid)
                  ? shareInputs(overlay.grid)
                  : copyGrid(overlay.grid),
              })),
            },
    ])
  );
  return { ...structuredClone({ ...source, numerical: {} }), numerical };
}
const immutable = (band: Band) => band.schema.immutable === true;
function immutableSamples(grid: GridSurface): boolean {
  return (
    immutable(grid.active) &&
    immutable(grid.measures) &&
    Object.values(grid.channels).every(immutable) &&
    Object.values(grid.topology ?? {})
      .filter((value): value is Band => value instanceof Band)
      .every(immutable) &&
    (grid.overlays ?? []).every((overlay) => immutableSamples(overlay.grid))
  );
}
/** Copy input metadata without expanding immutable committed bands into resident samples. */
export function cloneFieldInput(grid: GridSurface): GridSurface {
  return immutableSamples(grid) ? shareInputs(grid) : copyGrid(grid);
}
function shareInputs(grid: GridSurface): GridSurface {
  const copy: GridSurface = {
    ...grid,
    scope: structuredClone(grid.scope),
    bounds: [...grid.bounds],
    channels: { ...grid.channels },
    units: { ...grid.units },
    ...(grid.quantities ? { quantities: { ...grid.quantities } } : {}),
    ...(grid.overlays
      ? {
          overlays: grid.overlays.map((overlay) => ({
            ...overlay,
            channels: [...overlay.channels],
            grid: shareInputs(overlay.grid),
          })),
        }
      : {}),
  };
  if (grid.topology) copy.topology = { ...grid.topology, bounds: [...grid.topology.bounds] };
  return copy;
}
