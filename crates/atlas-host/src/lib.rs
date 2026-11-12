//! Coarse native/WASM boundary. Numerical loops stay inside the Rust engine.
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
        Ok(map) => MapValidation::Valid(map),
        Err(error) => MapValidation::Invalid(error),
    };
    serde_json::to_string(&reply).expect("Validated map values are JSON serializable")
}
