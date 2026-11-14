import type {
  MapNavigation,
  MapNavigationState,
  MapRef,
  NavigationChange,
  ReadOptions,
  RegionChoices,
  RegionDrawing,
  RegionDrawingResult,
  RegionQuery,
} from "@atlas/map";
import type { MapCatalog } from "./mapCatalog";
import { mapCall } from "./mapCall";

/** Region queries execute against GIS records and illustration files on the owning host. */
export class BrowserMapNavigation implements MapNavigation {
  constructor(
    private maps: MapCatalog,
    private files: { read(location: string): Promise<Uint8Array> }
  ) {}
  async read(reference: MapRef, options?: ReadOptions): Promise<MapNavigationState> {
    options?.signal?.throwIfAborted();
    return mapCall(this.maps.rust, "readNavigation", { reference });
  }
  async commit(
    reference: MapRef,
    state: MapNavigationState,
    change: NavigationChange,
    options?: ReadOptions
  ): Promise<MapNavigationState> {
    options?.signal?.throwIfAborted();
    return mapCall(this.maps.rust, "commitNavigation", { reference, state, change });
  }
  async choices(
    reference: MapRef,
    navigation: MapNavigationState,
    query: RegionQuery,
    options?: ReadOptions
  ): Promise<RegionChoices> {
    return this.execute("choices", { reference, navigation, query }, options);
  }
  async draw(
    reference: MapRef,
    navigation: MapNavigationState,
    drawing: RegionDrawing,
    options?: ReadOptions
  ): Promise<RegionDrawingResult> {
    return this.execute("draw", { reference, navigation, drawing }, options);
  }
  private async execute<T>(method: string, params: unknown, options?: ReadOptions): Promise<T> {
    options?.signal?.throwIfAborted();
    const value = await this.maps.rust.navigate(JSON.stringify({ method, params }), this.files);
    options?.signal?.throwIfAborted();
    return JSON.parse(value) as T;
  }
}
