import type { MapRef, NavigationChange, RegionQuery, RegionDrawing } from "./generated";
import type { MapReader, ReadOptions } from "./services";
import type { MapNavigation, NavigationOperations, NavigationStore } from "./navigation";
import { loadRegionInput } from "./regionInput";
import { mapPosition, mapSpace } from "./coordinates";

/** Host-local Rust computation and host-local map storage share the same coarse facade. */
export class ProductMapNavigation implements MapNavigation {
  constructor(
    private reader: MapReader,
    private store: NavigationStore,
    private engine: NavigationOperations
  ) {}
  async read(reference: MapRef, options?: ReadOptions) {
    await this.reader.open(reference, options);
    return this.store.read(reference);
  }
  async commit(
    reference: MapRef,
    expectedVersion: number,
    change: NavigationChange,
    options?: ReadOptions
  ) {
    const map = await this.reader.open(reference, options);
    const state = await this.store.read(reference);
    if (state.version !== expectedVersion)
      throw new Error("Map regions or views changed. Reload before saving.");
    const next = await this.engine.change(map, state, change);
    options?.signal?.throwIfAborted();
    await this.store.write(reference, expectedVersion, next);
    return next;
  }
  async choices(reference: MapRef, query: RegionQuery, options?: ReadOptions) {
    const map = await this.reader.open(reference, options);
    const navigation = await this.store.read(reference);
    const space = mapSpace(map, query.spaceId);
    query = { ...query, position: query.position && mapPosition(space, query.position) };
    const input = await loadRegionInput(this.reader, map, navigation, query, undefined, options);
    options?.signal?.throwIfAborted();
    return this.engine.choices(input, query);
  }
  async draw(reference: MapRef, drawing: RegionDrawing, options?: ReadOptions) {
    const map = await this.reader.open(reference, options);
    const navigation = await this.store.read(reference);
    const input = await loadRegionInput(
      this.reader,
      map,
      navigation,
      drawing.query,
      drawing,
      options
    );
    options?.signal?.throwIfAborted();
    return this.engine.draw(input, drawing);
  }
}
