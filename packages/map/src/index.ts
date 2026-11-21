// owner-direction(2026-11-12): map and generation use separate schemas
export type * from "./generated";
export type * from "./generatedEditing";
export type * from "./generatedAuthoring";
export type * from "./services";
export { terrainLayerId, terrainBands } from "./terrain";
export { mapSpace, mapPosition, mapBounds } from "./coordinates";
export { collectPages } from "./interactions";
export { structureVocabulary } from "./generatedStructure";
export type * from "./registry";
export type { MapNavigation, NavigationOperations } from "./navigation";
export type { MapEditing } from "./editing";
