import type { DomainSnapshot } from "./operations";

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
      authored.has(id)
        ? structuredClone(grid)
        : {
            ...grid,
            channels: { ...grid.channels },
            units: { ...grid.units },
            quantities: { ...grid.quantities },
            overlays: grid.overlays ? structuredClone(grid.overlays) : undefined,
          },
    ])
  );
  return { ...structuredClone({ ...source, numerical: {} }), numerical };
}
