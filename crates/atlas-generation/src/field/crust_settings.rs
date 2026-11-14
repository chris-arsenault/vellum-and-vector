use crate::scale_settings::{ResolvedSettings, ScaleDefinition};
use serde::Deserialize;

pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "MarginInfluenceReach":{"kind":"relative-measure","fraction":0.065,"dimension":1,"exponent":1},
        "CrustAgeSaturationDistance":{"kind":"relative-measure","fraction":0.175,"dimension":1,"exponent":1},
        "OceanicSubsidenceDepth":{"kind":"relative-measure","fraction":0.0003,"dimension":1,"exponent":1},
        "OceanicSubsidenceCompositionLimit":0.5,
        "ConvergentTrenchDepth":{"kind":"relative-measure","fraction":0.000225,"dimension":1,"exponent":1},
        "MarginEvolutionResponsePerMille":760,
        "ContinentalAssemblySeparationDepth":0.38,
        "SedimentLoadResponsePerMille":360,
        "IceLoadResponsePerMille":1000.0*910.0/3300.0,
        "LithosphericFlexureLength":{"kind":"relative-measure","fraction":0.025,"dimension":1,"exponent":1},
        "ContinentalWarpScale":{"kind":"relative-measure","fraction":0.135,"dimension":1,"exponent":1},
        "PlumeLobeScale":{"kind":"relative-measure","fraction":0.0225,"dimension":1,"exponent":1},
        "PlumeLobeStrength":620,
        "GeothermalVentThreshold":720
    }})).expect("Declared crust settings")
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    pub margin_influence_reach: f64,
    pub crust_age_saturation_distance: f64,
    pub oceanic_subsidence_depth: f64,
    pub oceanic_subsidence_composition_limit: f64,
    pub convergent_trench_depth: f64,
    pub margin_evolution_response_per_mille: f64,
    pub continental_assembly_separation_depth: f64,
    pub sediment_load_response_per_mille: f64,
    pub ice_load_response_per_mille: f64,
    pub lithospheric_flexure_length: f64,
    pub continental_warp_scale: f64,
    pub plume_lobe_scale: f64,
    pub plume_lobe_strength: f64,
    pub geothermal_vent_threshold: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
}
