use crate::scale_settings::{ResolvedSettings, ScaleDefinition};
use serde::Deserialize;
pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "OpenBedSeepage":3e-6,"LakeCompactnessShare":560,
        "LakeInfiltrationLoss":{"kind":"relative-measure","fraction":3.5e-8,"dimension":1,"exponent":1,"unit":"mm"},
        "LakeDepthThreshold":{"kind":"relative-measure","fraction":0.00001125,"dimension":1,"exponent":1},
        "MinimumLakeArea":{"kind":"relative-measure","fraction":0.000003125,"dimension":2,"exponent":1}
    }})).expect("Declared lake and river settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    pub open_bed_seepage: f64,
    pub lake_infiltration_loss: f64,
    pub lake_depth_threshold: f64,
    pub minimum_lake_area: f64,
    pub lake_compactness_share: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
}
