import {
  overlayField,
  requireThat,
  gridType,
  type DomainSnapshot,
  type ReadRequirements,
  type SpatialStore,
  type BlockCache,
  type Grid,
  type NumericalResource,
  type FieldGeography,
  type ChangeSet,
} from "@atlas/domain";
import {
  FieldWorkingSet,
  writeFieldLayout,
  writeFieldChannels,
  type FieldInputStore,
} from "@atlas/storage-browser";

export class WorkspaceFields {
  private working: FieldWorkingSet;
  readonly outputs: NumericalResource[] = [];
  readonly geography: FieldGeography[] = [];
  private committed = false;
  constructor(
    private catalog: SpatialStore,
    private resources: FieldInputStore,
    readonly blocks: BlockCache
  ) {
    this.working = new FieldWorkingSet(resources, blocks);
  }
  async read(snapshot: DomainSnapshot, input: ReadRequirements) {
    for (const { fieldId, names } of input.channels) {
      const field = snapshot.world.fields.find((f) => f.id === fieldId);
      requireThat(
        field?.resourceId,
        "missing_field",
        "The command needs a published numerical field."
      );
      const grid = await this.load(field.resourceId, names);
      snapshot.numerical[field.id] = grid;
      snapshot.resources.push({
        id: field.resourceId,
        kind: gridType.kind,
        schemaId: gridType.id,
        schemaVersion: gridType.version,
        revision: field.resourceId,
        scope: grid.scope,
        unit: "grid",
        facts: [field.layerId, ...names],
        lineage: [],
      });
      for (const patch of snapshot.fieldPatches.filter((p) => p.fieldId === field.id)) {
        const channels = patch.channels.filter((name) => names.includes(name));
        if (!channels.length) continue;
        const value = await this.load(patch.resourceId, channels);
        overlayField(grid, value, channels, patch.mapOnly);
        snapshot.resources.push({
          id: patch.resourceId,
          kind: gridType.kind,
          schemaId: gridType.id,
          schemaVersion: gridType.version,
          revision: patch.resourceId,
          scope: value.scope,
          unit: "grid",
          facts: channels,
          lineage: [field.resourceId],
        });
      }
    }
  }
  private async load(id: string, names: string[]): Promise<Grid> {
    const resource = await this.resources.describe(id);
    requireThat(
      resource.field,
      "field_resource",
      "Published sampled geography needs its field manifest."
    );
    const geography = await this.catalog.readFieldGeography(
      resource.scope,
      resource.field.geographyId
    );
    return this.working.load(id, names, geography);
  }
  async publish(changes: ChangeSet, precision: number) {
    for (const { grid, reference } of changes.fieldArtifacts ?? []) {
      const shared = await writeFieldLayout(
        this.resources,
        grid,
        `${reference.id}:layout`,
        precision
      );
      this.outputs.push(shared.layout);
      if (shared.tree) this.outputs.push(shared.tree);
      this.geography.push(shared.geography);
      this.outputs.push(await writeFieldChannels(this.resources, grid, reference.id, shared));
    }
  }
  accept() {
    this.committed = true;
  }
  async close() {
    this.working.close();
    if (!this.committed)
      for (const output of [...this.outputs].reverse()) await this.resources.remove(output.id);
  }
}
