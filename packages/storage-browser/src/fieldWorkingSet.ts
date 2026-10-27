import {
  requireThat,
  type AdaptiveTopology,
  type FieldGeography,
  type Grid,
  type NumericalAllocator,
  type NumericalResource,
  type NumericalVector,
  type ResourceStore,
} from "@atlas/domain";

/** Local execution adapter; the domain resource repository remains asynchronous and portable. */
export interface FieldInputStore extends ResourceStore {
  openArray(id: string, name: string, allocator: NumericalAllocator): Promise<NumericalVector>;
}
const topologyCells = [
  "leaves",
  "offsets",
  "neighbors",
  "faceLengths",
  "distances",
  "directionX",
  "directionY",
  "normalX",
  "normalY",
];
const topologyTree = ["boxes", "children", "levels", "leafIndex"];
function vectorKey(resource: NumericalResource, name: string) {
  const array = resource.arrays.find((a) => a.name === name)!;
  return `${array.source?.resourceId ?? resource.id}:${array.source?.array ?? name}`;
}
/** Active readers share immutable array handles; the last reader closes the underlying input. */
export class FieldInputCache {
  private entries = new Map<
    string,
    { users: number; opened: Promise<NumericalVector>; vector?: NumericalVector }
  >();
  constructor(
    private store: FieldInputStore,
    private allocator: NumericalAllocator
  ) {}
  async acquire(resource: NumericalResource, name: string) {
    const key = vectorKey(resource, name);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { users: 0, opened: this.store.openArray(resource.id, name, this.allocator) };
      this.entries.set(key, entry);
    }
    entry.users++;
    try {
      return (entry.vector ??= await entry.opened);
    } catch (error) {
      this.release(key);
      throw error;
    }
  }
  release(key: string) {
    const entry = this.entries.get(key);
    if (!entry || --entry.users > 0) return;
    this.entries.delete(key);
    if (entry.vector) this.allocator.release(entry.vector);
  }
}
function fieldChannels(
  resource: NumericalResource,
  vectors: Record<string, NumericalVector>,
  names: string[]
) {
  const field = resource.field!,
    channels: Record<string, NumericalVector> = {},
    units: Record<string, string> = {},
    quantities: Record<string, "category" | "intensive" | "extensive"> = {};
  for (const name of names) {
    const array = resource.arrays.find((a) => a.name === field.channels[name])!;
    requireThat(
      array.quantity !== "topology",
      "field_channel",
      "Field channel quantities must describe samples."
    );
    channels[name] = vectors[array.name];
    units[name] = array.unit;
    quantities[name] = array.quantity;
  }
  return { channels, units, quantities };
}
/** Immutable input handles share decoded chunks; working outputs use the operation's arena. */
export class FieldWorkingSet {
  private loaded = new Map<string, NumericalVector>();
  private closed = false;
  constructor(
    private store: FieldInputStore,
    allocator: NumericalAllocator,
    private inputs = new FieldInputCache(store, allocator)
  ) {}
  async load(id: string, names: string[], geography: FieldGeography): Promise<Grid> {
    requireThat(!this.closed, "field_closed", "The numerical operation has ended.");
    const resource = await this.store.describe(id),
      field = resource.field;
    requireThat(
      resource.state === "ready" && field,
      "field_resource",
      "Load a completed field resource."
    );
    requireThat(
      geography.id === field.geographyId &&
        geography.scope.worldId === resource.scope.worldId &&
        geography.scope.spaceId === resource.scope.spaceId,
      "field_geography",
      "Field geography belongs to the same located resource."
    );
    requireThat(
      names.every((name) => Object.hasOwn(field.channels, name)),
      "field_channel",
      "Requested field channels must exist."
    );
    const selected = ["active", "measures", ...names.map((name) => field.channels[name])];
    if (resource.layout === "adaptive") selected.push(...topologyCells);
    const vectors = await this.openVectors(resource, selected);
    const common = {
      id: field.id,
      scope: field.scope,
      bounds: resource.bounds,
      periodicWidth: resource.periodicWidth,
      active: vectors.active,
      measures: vectors.measures,
      ...fieldChannels(resource, vectors, names),
      ocean: geography.ocean,
      waterBodies: geography.waterBodies,
    };
    if (resource.layout === "regular") {
      requireThat(resource.sampling, "field_layout", "Regular fields declare their dimensions.");
      return { ...common, ...resource.sampling };
    }
    const topology = await this.openTopology(resource, vectors);
    return { ...common, topology };
  }
  private async openTopology(resource: NumericalResource, cells: Record<string, NumericalVector>) {
    requireThat(
      resource.layout === "adaptive" && resource.field?.treeResourceId,
      "field_layout",
      "Adaptive fields declare their tree resource."
    );
    const tree = await this.store.describe(resource.field.treeResourceId),
      vectors = await this.openVectors(tree, topologyTree);
    const topology: AdaptiveTopology = {
      bounds: tree.bounds,
      boxes: vectors.boxes,
      children: vectors.children,
      levels: vectors.levels,
      leafIndex: vectors.leafIndex,
      leaves: cells.leaves,
      offsets: cells.offsets,
      neighbors: cells.neighbors,
      faceLengths: cells.faceLengths,
      distances: cells.distances,
      directionX: cells.directionX,
      directionY: cells.directionY,
      normalX: cells.normalX,
      normalY: cells.normalY,
    };
    return topology;
  }
  private async openVectors(resource: NumericalResource, names: string[]) {
    const result: Record<string, NumericalVector> = {},
      staged = new Map<string, NumericalVector>();
    try {
      for (const name of names) {
        requireThat(
          resource.arrays.some((a) => a.name === name),
          "field_layout",
          `Field layout requires ${name}.`
        );
        const key = vectorKey(resource, name);
        let values = this.loaded.get(key) ?? staged.get(key);
        if (!values) {
          values = await this.inputs.acquire(resource, name);
          staged.set(key, values);
        }
        result[name] = values;
      }
      for (const [key, vector] of staged) this.loaded.set(key, vector);
      return result;
    } catch (error) {
      for (const key of staged.keys()) this.inputs.release(key);
      throw error;
    }
  }
  close() {
    if (this.closed) return;
    for (const key of this.loaded.keys()) this.inputs.release(key);
    this.loaded.clear();
    this.closed = true;
  }
}
