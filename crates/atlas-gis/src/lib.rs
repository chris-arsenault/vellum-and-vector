//! GIS storage and queries shared by the viewer and publisher.
//! This component cannot open numerical generation state or execute the generator.
// owner-direction(2026-11-14): viewer and generator are independent clients of GIS storage through data boundaries, not language boundaries
pub mod authoring;
#[cfg(target_arch = "wasm32")]
pub mod browser_map_store;
pub mod geometry;
mod geometry_bulk;
mod geometry_sites;
mod geometry_trace;
pub mod map_files;
pub mod map_navigation;
pub mod map_protocol;
pub mod map_store;
pub mod native_map_geometry;
#[cfg(not(target_arch = "wasm32"))]
pub mod postgres_maps;
pub mod sql;
pub mod stored;

use atlas_map::{MapDescriptor, MapError, MapErrorCode, MapValidation};

#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn validate_map(input: &str) -> String {
    let result = serde_json::from_str::<MapDescriptor>(input)
        .map_err(|error| MapError::new(MapErrorCode::InvalidMap, error.to_string()))
        .and_then(|map| {
            map.validate()?;
            Ok(map)
        });
    let reply = match result {
        Ok(map) => MapValidation::Valid(Box::new(map)),
        Err(error) => MapValidation::Invalid(error),
    };
    serde_json::to_string(&reply).expect("Validated map values are JSON serializable")
}
