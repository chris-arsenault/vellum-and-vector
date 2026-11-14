import init, { validate_map } from "../dist/atlas_host.js";
import type { MapDescriptor, MapValidation } from "@atlas/map";

export { BrowserMapRaster } from "../dist/atlas_host.js";
export { BrowserMapStore } from "../dist/atlas_host.js";
export { map_navigation } from "../dist/atlas_host.js";
export { generate_map } from "../dist/atlas_host.js";
export { publish_finished_map } from "../dist/atlas_host.js";
export {
  BrowserJob,
  BrowserInputs,
  BrowserNumericalInputs,
  generation_defaults,
  create_generation_world,
  normalize_generation_configuration,
  generation_presentation,
  choose_generation_configuration,
} from "../dist/atlas_host.js";
export type { NavigationOperations, NavigationOperation } from "./navigation";
export type { RasterPublicationInput } from "@atlas/context";
let ready: ReturnType<typeof init> | undefined;

/** Each worker initializes its own engine; tests can supply the same compiled module bytes. */
export function initializeEngine(module?: BufferSource | WebAssembly.Module) {
  return (ready ??= init({
    module_or_path: module ?? new URL("../dist/atlas_host_bg.wasm", import.meta.url),
  }));
}

/** Both hosts enforce the Rust map contract before storing a publication descriptor. */
export function validateMap(map: MapDescriptor): MapDescriptor {
  const result = JSON.parse(validate_map(JSON.stringify(map))) as MapValidation;
  if (result.status === "invalid") throw new Error(result.value.message);
  return result.value;
}
