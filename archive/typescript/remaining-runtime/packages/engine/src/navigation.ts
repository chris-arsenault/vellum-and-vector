import type {
  MapDescriptor,
  MapNavigationState,
  NavigationChange,
  RegionInput,
  RegionQuery,
  RegionDrawing,
} from "@atlas/map";
export type { NavigationOperations } from "@atlas/map";
export type NavigationOperation =
  | { method: "choices"; params: [RegionInput, RegionQuery] }
  | { method: "draw"; params: [RegionInput, RegionDrawing] }
  | { method: "change"; params: [MapDescriptor, MapNavigationState, NavigationChange] };
