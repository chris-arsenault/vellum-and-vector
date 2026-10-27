import type { ObjectKind, RecordReference, WorkspaceChange } from "@atlas/domain";

/** Bulk publications describe changed kinds and spatial envelopes, not millions of identities. */
export class ChangeAccumulator {
  readonly value: WorkspaceChange;
  private kinds = new Set<ObjectKind>();
  private layerIds = new Set<string>();
  constructor(
    worldId: string,
    operationId: string,
    private bulk: boolean
  ) {
    this.value = {
      worldId,
      operationId,
      revision: 0,
      records: [],
      extents: [],
      geometryExtents: [],
      layers: [],
      resources: [],
    };
  }
  layers(ids: string[]) {
    for (const id of ids) this.layerIds.add(id);
    this.value.layers = [...this.layerIds];
  }
  add(
    records: RecordReference[],
    extents: WorkspaceChange["extents"],
    geometry: WorkspaceChange["extents"],
    resources: string[]
  ) {
    for (const record of records) this.kinds.add(record.kind);
    this.value.recordKinds = [...this.kinds];
    this.value.resources.push(...resources);
    if (!this.bulk) {
      this.value.records.push(...records.map((r) => ({ ...r, revision: this.value.revision })));
      this.value.extents.push(...extents);
      this.value.geometryExtents!.push(...geometry);
      return;
    }
    mergeExtents(this.value.extents, extents);
    mergeExtents(this.value.geometryExtents!, geometry);
  }
}
function mergeExtents(target: WorkspaceChange["extents"], values: WorkspaceChange["extents"]) {
  for (const value of values) {
    const existing = target.find((item) => item.spaceId === value.spaceId);
    if (!existing) target.push({ spaceId: value.spaceId, bounds: [...value.bounds] });
    else {
      existing.bounds[0] = Math.min(existing.bounds[0], value.bounds[0]);
      existing.bounds[1] = Math.min(existing.bounds[1], value.bounds[1]);
      existing.bounds[2] = Math.max(existing.bounds[2], value.bounds[2]);
      existing.bounds[3] = Math.max(existing.bounds[3], value.bounds[3]);
    }
  }
}
