use crate::scale_settings::{ResolvedSettings, ScaleDefinition};
use serde::Deserialize;

pub fn settings() -> ScaleDefinition {
    // owner-direction(2026-11-07): plate travel is a share of the world's size, not a fixed distance.
    ScaleDefinition::from_value(serde_json::json!({ "kind":"relative-settings", "values": {
        "PlateDriftPerMyr":{"kind":"relative-measure","fraction":0.025,"dimension":1,"exponent":1},
        "ContinentalTransitionWidth":{"kind":"relative-measure","fraction":0.065,"dimension":1,"exponent":1},
        "ContinentalAssemblySeparationDepth":0.38,
        "ContinentalCrustPotentialFloor":0.62,
        "OceanicCrustPotentialCeiling":0.38,
        "ContinentalWarpScale":{"kind":"relative-measure","fraction":0.135,"dimension":1,"exponent":1},
        "ContinentalWarpStrength":{"kind":"relative-measure","fraction":0.045,"dimension":1,"exponent":1},
        "RidgeWidth":{"kind":"relative-measure","fraction":0.0275,"dimension":1,"exponent":1},
        "TectonicConvergenceThreshold":0.12
    }})).expect("Declared province assignment settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    pub plate_drift_per_myr: f64,
    pub continental_transition_width: f64,
    pub continental_assembly_separation_depth: f64,
    pub continental_crust_potential_floor: f64,
    pub oceanic_crust_potential_ceiling: f64,
    pub continental_warp_scale: f64,
    pub continental_warp_strength: f64,
    pub ridge_width: f64,
    pub tectonic_convergence_threshold: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
}
