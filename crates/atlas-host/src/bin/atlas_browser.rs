//! Browser entry point links the same GEOS and SQLite libraries as the native host.
// Arconis: docs/architecture/subsystems.arconis#item=wasm_generator — WASM build of the shared Rust engine.
pub use atlas_gis::*;
pub use atlas_host::*;

fn main() {}
