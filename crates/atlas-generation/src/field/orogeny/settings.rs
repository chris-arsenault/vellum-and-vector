use crate::scale_settings::{ResolvedSettings, ScaleDefinition};
use serde::Deserialize;
pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "OrogenicMinimumStrain":80,"OrogenicAccretionRatio":1,"ThrustTiltGradient":0.04,"ThrustRampGradient":0.04,"OrogenicRockShare":0.5,
        "OrogenicMinimumComponentArea":{"kind":"relative-measure","fraction":0.0000375,"dimension":2,"exponent":1},
        "OrogenicAlongStrikeScale":{"kind":"relative-measure","fraction":0.105,"dimension":1,"exponent":1},
        "OrogenicSheetSpacing":{"kind":"relative-measure","fraction":0.025,"dimension":1,"exponent":1},
        "OrogenicSegmentLength":{"kind":"relative-measure","fraction":0.065,"dimension":1,"exponent":1},
        "OrogenicInitialShortening":{"kind":"relative-measure","fraction":0.15,"dimension":1,"exponent":1},
        "CrustFlowYield":{"kind":"relative-measure","fraction":0.00075,"dimension":1,"exponent":1},
        "CrustFlowEase":{"kind":"relative-measure","fraction":0.0005,"dimension":1,"exponent":1},
        "CrustFlowLength":{"kind":"relative-measure","fraction":0.05,"dimension":1,"exponent":1},
        "SutureReactivationPerSpan":{"kind":"relative-measure","fraction":0.002,"dimension":1,"exponent":1},
        "SutureReactivationZone":{"kind":"relative-measure","fraction":0.05,"dimension":1,"exponent":1}
    }})).expect("Declared orogenic settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    pub orogenic_minimum_strain: f64,
    pub orogenic_accretion_ratio: f64,
    pub thrust_tilt_gradient: f64,
    pub thrust_ramp_gradient: f64,
    pub orogenic_rock_share: f64,
    pub orogenic_minimum_component_area: f64,
    pub orogenic_along_strike_scale: f64,
    pub orogenic_sheet_spacing: f64,
    pub orogenic_segment_length: f64,
    pub orogenic_initial_shortening: f64,
    pub crust_flow_yield: f64,
    pub crust_flow_ease: f64,
    pub crust_flow_length: f64,
    pub suture_reactivation_per_span: f64,
    pub suture_reactivation_zone: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
}
