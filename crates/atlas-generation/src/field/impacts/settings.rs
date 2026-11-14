use crate::scale_settings::{ResolvedSettings, ScaleDefinition};
use serde::Deserialize;
pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "ImpactCraterCount":6,"ImpactPrimordialShare":620,
        "ImpactMinimumRadius":{"kind":"relative-measure","fraction":0.0125,"dimension":1,"exponent":1},
        "ImpactMaximumRadius":{"kind":"relative-measure","fraction":0.045,"dimension":1,"exponent":1},
        "ImpactMinimumSpacing":{"kind":"relative-measure","fraction":0.055,"dimension":1,"exponent":1},
        "ElevationScale":{"kind":"relative-measure","fraction":0.00025,"dimension":1,"exponent":1},
        "ImpactDepthRatio":1200,"ImpactRimHeightRatio":450,"ImpactEjectaFraction":520,"ImpactFractureStrength":760,
        "ImpactOceanShockDepth":{"kind":"relative-measure","fraction":0.00015,"dimension":1,"exponent":1},
        "ImpactThermalRadiusThreshold":{"kind":"relative-measure","fraction":0.03,"dimension":1,"exponent":1}
    }})).expect("Declared impact settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    pub impact_crater_count: f64,
    pub impact_primordial_share: f64,
    pub impact_minimum_radius: f64,
    pub impact_maximum_radius: f64,
    pub impact_minimum_spacing: f64,
    pub elevation_scale: f64,
    pub impact_depth_ratio: f64,
    pub impact_rim_height_ratio: f64,
    pub impact_ejecta_fraction: f64,
    pub impact_fracture_strength: f64,
    pub impact_ocean_shock_depth: f64,
    pub impact_thermal_radius_threshold: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
}
