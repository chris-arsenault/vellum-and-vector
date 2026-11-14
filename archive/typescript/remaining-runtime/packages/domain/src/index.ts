/** Frontend contracts and presentation helpers. All generation executes in Rust. */
export type {
  AtlasFeature,
  Epoch,
  LayerStyle,
  NetworkNode,
  NetworkReach,
  Position,
  Profile,
  World,
} from "../contracts/model";
export type {
  AttributeFilter,
  RegistryColumn,
  RegistryFacets,
  RegistryQuery,
} from "../contracts/registry";
export type { Bounds, SpatialIndex, SpatialOperations } from "../contracts/spatial";
export type {
  CartographicMark,
  CartographicOverride,
  CartographicPresentation,
} from "../contracts/cartographicPresentation";
export type { ConfluenceEffects, MagicConfluence } from "../contracts/magicConfluences";
export type { Diagnostic } from "../contracts/errors";
export type { EcologyEpoch } from "../contracts/ecology";
export type { EpochHistory } from "../contracts/generationHistory";
export type {
  FeatureReader,
  FeatureSelection,
  FeatureWorkspace,
} from "../contracts/featureWorkspace";
export type { FeatureType, FeatureTypeStyle } from "../contracts/featureCatalogue";
export type { FieldGeography, NumericalResource } from "../contracts/workspaceResources";
export type { Landmark } from "../contracts/landmarks";
export type {
  MagicCondition,
  MagicFeatureRule,
  MagicOrigin,
  MagicPropagation,
  MagicRenewal,
  MagicSource,
  MagicSystem,
} from "../contracts/magicSystems";
export type {
  NetworkReader,
  NetworkWorkspace,
  ReachSelection,
} from "../contracts/networkWorkspace";
export type { ParameterValues, SpatialScope } from "../contracts/schemas";
export type { PopulationGroup } from "../contracts/society";
export type { RandomAccessFile } from "../contracts/lattice/blockScratch";
export type { SurfaceCategory } from "../contracts/geographySurfaces";
export type { WorkspaceScope } from "../contracts/workspace";
export { DomainError, requireThat } from "./errors";
export { ByteCache } from "./byteCache";
export {
  configureSpatial,
  spatial,
  Spatial,
  point,
  rectangle,
  toWorld,
  fromWorld,
  transformGeometry,
} from "./spatial";
export { MapScale } from "./mapScale";
export { beforePresentEpoch } from "./society";
export { magicRenewals, magicPhysicalFields } from "./magicSystems";
export { magicParameterDimensions } from "./magicDimensions";
export { locatedMagicEffectDefinitions } from "./magicEffects";
export { landmarkKind } from "./landmarks";
export { sameValue } from "./values";
