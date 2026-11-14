//! Material facts and process actions meet through modes, owned here rather than in callers.
pub mod cargo;
pub mod cargo_identity;
pub mod catalogue;
pub mod coarsening;
pub mod columns;
pub mod extraction;
pub mod ground;
pub mod layer_bands;
pub mod load;
pub mod material;
mod modes;
pub mod organic;
pub mod transforms;
pub use modes::{
    compile_mix, material_gives, CompiledMix, MaterialFacts, MaterialResponse, ModeId, ModeMix,
};
