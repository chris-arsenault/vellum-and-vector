import {
  gridType,
  requireThat,
  type DomainSnapshot,
  type GridSurface,
  type ChangeSet,
} from "@atlas/domain";

/** Publish a supplied resident snapshot's fields as immutable workspace resources. */
export class SnapshotFields {
  private ids = new WeakMap<GridSurface, string>();
  prepare(source: DomainSnapshot) {
    const artifacts: NonNullable<ChangeSet["fieldArtifacts"]> = [];
    const publish = (saved: GridSurface | undefined) => {
      requireThat(saved, "saved_field", "A saved numerical field is missing its samples.");
      const previous = this.ids.get(saved);
      if (previous) return previous;
      const id = crypto.randomUUID();
      this.ids.set(saved, id);
      const { overlays, ...samples } = saved;
      void overlays;
      artifacts.push({
        grid: samples,
        reference: {
          id,
          kind: gridType.kind,
          schemaId: gridType.id,
          schemaVersion: gridType.version,
          revision: id,
          scope: saved.scope,
          unit: "grid",
          facts: Object.keys(saved.channels),
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
