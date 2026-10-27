import {
  gridType,
  requireThat,
  type DomainSnapshot,
  type GridSurface,
  type ChangeSet,
} from "@atlas/domain";

/** Only explicit imports of the released IndexedDB format contain resident grids. Mint
 * immutable resource identities because that format allowed arrays to change in place. */
export class LegacyFields {
  private ids = new WeakMap<GridSurface, string>();
  prepare(source: DomainSnapshot) {
    const artifacts: NonNullable<ChangeSet["fieldArtifacts"]> = [];
    const publish = (grid: GridSurface | undefined) => {
      requireThat(grid, "saved_field", "A saved numerical field is missing its samples.");
      const previous = this.ids.get(grid);
      if (previous) return previous;
      const id = crypto.randomUUID();
      this.ids.set(grid, id);
      const { overlays, ...samples } = grid;
      void overlays;
      artifacts.push({
        grid: samples,
        reference: {
          id,
          kind: gridType.kind,
          schemaId: gridType.id,
          schemaVersion: gridType.version,
          revision: id,
          scope: grid.scope,
          unit: "grid",
          facts: Object.keys(grid.channels),
          lineage: [],
        },
      });
      return id;
    };
    const fields = source.world.fields.map((field) => ({
      ...field,
      resourceId: publish(source.numerical[field.id]),
    }));
    const patches = source.fieldPatches.map((patch) => {
      const grid =
        source.numerical[patch.resourceId] ??
        source.numerical[patch.fieldId]?.overlays?.find(
          (overlay) => overlay.grid.id === patch.resourceId
        )?.grid;
      return { ...patch, resourceId: publish(grid) };
    });
    return {
      snapshot: { ...source, world: { ...source.world, fields }, fieldPatches: patches },
      artifacts,
    };
  }
}
