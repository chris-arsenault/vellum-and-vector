use crate::scale_settings::{ResolvedSettings, ScaleDefinition};
use serde::Deserialize;
pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "VolcanicConeRadius":{"kind":"relative-measure","fraction":0.015,"dimension":1,"exponent":1},
        "VolcanicConeHeight":{"kind":"relative-measure","fraction":0.00125,"dimension":1,"exponent":1},
        "LavaYieldHeight":{"kind":"relative-measure","fraction":5e-9,"dimension":1,"exponent":1},
        "LavaCoolingDistance":{"kind":"relative-measure","fraction":0.03,"dimension":1,"exponent":1}
    }})).expect("Declared volcanic settings")
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    pub volcanic_cone_radius: f64,
    pub volcanic_cone_height: f64,
    pub lava_yield_height: f64,
    pub lava_cooling_distance: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
}
