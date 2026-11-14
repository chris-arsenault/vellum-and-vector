use crate::scale_settings::{ResolvedSettings, ScaleDefinition};
use serde::Deserialize;

pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "FractureBranchCount":24,
        "FractureMinimumLength":{"kind":"relative-measure","fraction":0.045,"dimension":1,"exponent":1},
        "FractureMaximumLength":{"kind":"relative-measure","fraction":0.3,"dimension":1,"exponent":1},
        "FractureMinimumSpacing":{"kind":"relative-measure","fraction":0.045,"dimension":1,"exponent":1},
        "FractureWidth":{"kind":"relative-measure","fraction":0.0025,"dimension":1,"exponent":1},
        "FractureConductanceFloor":25,"FractureRetentionPerSpan":400
    }})).expect("Declared fracture settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    pub(super) fracture_branch_count: f64,
    pub(super) fracture_minimum_length: f64,
    pub(super) fracture_maximum_length: f64,
    pub(super) fracture_minimum_spacing: f64,
    pub(super) fracture_width: f64,
    pub(super) fracture_conductance_floor: f64,
    pub(super) fracture_retention_per_span: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
}
