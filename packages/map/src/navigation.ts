import type {
  MapRef,
  MapNavigationState,
  NavigationChange,
  RegionQuery,
  RegionChoices,
  RegionDrawing,
  RegionDrawingResult,
  RegionInput,
  MapDescriptor,
} from "./generated";
import type { ReadOptions } from "./services";

/** Region geometry is resolved on the same host that owns the map catalogue. */
export interface MapNavigation {
  read(reference: MapRef, options?: ReadOptions): Promise<MapNavigationState>;
  commit(
    reference: MapRef,
    state: MapNavigationState,
    change: NavigationChange,
    options?: ReadOptions
  ): Promise<MapNavigationState>;
  choices(
    reference: MapRef,
    state: MapNavigationState,
    query: RegionQuery,
    options?: ReadOptions
  ): Promise<RegionChoices>;
  draw(
    reference: MapRef,
    state: MapNavigationState,
    input: RegionDrawing,
    options?: ReadOptions
  ): Promise<RegionDrawingResult>;
}

export interface NavigationOperations {
  choices(input: RegionInput, query: RegionQuery): RegionChoices | Promise<RegionChoices>;
  draw(
    input: RegionInput,
    drawing: RegionDrawing
  ): RegionDrawingResult | Promise<RegionDrawingResult>;
  change(
    map: MapDescriptor,
    state: MapNavigationState,
    change: NavigationChange
  ): MapNavigationState | Promise<MapNavigationState>;
}
