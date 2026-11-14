use atlas_map::regions::{change_navigation, draw_region, region_choices, RegionInput};
use atlas_map::spatial::SpatialKernel;
use atlas_map::{MapDescriptor, MapNavigationState, NavigationChange, RegionDrawing, RegionQuery};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
#[serde(tag = "method", content = "params", rename_all = "camelCase")]
pub enum NavigationOperation {
    Choices(RegionInput, RegionQuery),
    Draw(RegionInput, RegionDrawing),
    Change(MapDescriptor, MapNavigationState, NavigationChange),
}
impl NavigationOperation {
    pub fn precision(&self) -> Result<f64, String> {
        let (map, space_id) = match self {
            Self::Choices(input, query) => (&input.map, &query.space_id),
            Self::Draw(input, drawing) => (&input.map, &drawing.query.space_id),
            Self::Change(map, _, _) => (map, &map.primary_space_id),
        };
        map.spaces
            .iter()
            .find(|space| space.id == *space_id)
            .map(|space| space.precision)
            .ok_or_else(|| "Choose a coordinate space on this map".into())
    }
    pub fn execute(self, kernel: &dyn SpatialKernel) -> Result<serde_json::Value, String> {
        match self {
            Self::Choices(input, query) => {
                serde_json::to_value(region_choices(&input, &query, kernel)?)
            }
            Self::Draw(input, drawing) => {
                serde_json::to_value(draw_region(&input, &drawing, kernel)?)
            }
            Self::Change(map, state, change) => {
                serde_json::to_value(change_navigation(&map, &state, change, kernel)?)
            }
        }
        .map_err(|error| error.to_string())
    }
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn map_navigation(input: &str) -> Result<String, wasm_bindgen::JsValue> {
    let run = || -> Result<String, String> {
        let operation: NavigationOperation =
            serde_json::from_str(input).map_err(|error| error.to_string())?;
        let spatial = crate::geometry::NativeGeos::new(operation.precision()?)?;
        let result = operation.execute(&spatial)?;
        serde_json::to_string(&result).map_err(|error| error.to_string())
    };
    run().map_err(|error| wasm_bindgen::JsValue::from_str(&error))
}
