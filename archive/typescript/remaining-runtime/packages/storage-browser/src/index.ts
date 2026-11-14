/** Browser platform bindings. Catalog and numerical storage rules execute in Rust. */
export { GeometryKernel } from "./geometryKernel";
export { GeosSpatial } from "./geosSpatial";
export { rustSpatial } from "./rustSpatial";
export { OpfsStore, type BinaryStore, type BinarySnapshot } from "./opfsStore";
export type {
  Database as CatalogDatabase,
  Statement as CatalogStatement,
  SqlValue as CatalogValue,
  BindableValue as CatalogBinding,
} from "./catalogDatabase";
