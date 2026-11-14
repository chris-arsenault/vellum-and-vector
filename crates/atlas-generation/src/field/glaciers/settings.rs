use crate::scale_settings::{ResolvedSettings, ScaleDefinition};
use serde::Deserialize;
pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "IceTemperatureThreshold":285,"MinimumIceBalance":80,"IceTransportYears":1000,
        "FrozenLakeIceAdvanceGradient":0.004,"GlacierGroundingFraction":900,
        "GlacialCutPerSpeed":0.2,"MassWastingStableGradient":0.7,
        "IceAltitudeBalance":{"kind":"relative-measure","fraction":0,"dimension":-1,"exponent":1},
        "IceYieldHeight":{"kind":"relative-measure","fraction":0.00235,"dimension":0.5,"exponent":1},
        "IceAblationStep":{"kind":"relative-measure","fraction":0.000065,"dimension":1,"exponent":1},
        "GlacierFrozenSpeed":{"kind":"relative-measure","fraction":0.00000125,"dimension":1,"exponent":1},
        "HillslopeLength":{"kind":"relative-measure","fraction":0.00025,"dimension":1,"exponent":1},
        "MoraineMinimumGlacialDeposition":{"kind":"relative-measure","fraction":0.0000025,"dimension":1,"exponent":1},
        "UValleyMinimumGlacialErosion":{"kind":"relative-measure","fraction":0.000002,"dimension":1,"exponent":1},
        "MountainElevation":{"kind":"relative-measure","fraction":0.00025,"dimension":1,"exponent":1},
        "GlacierThicknessThreshold":{"kind":"relative-measure","fraction":0.0000625,"dimension":1,"exponent":1},
        "LandformNeighborhoodRadius":{"kind":"relative-measure","fraction":0.0025,"dimension":1,"exponent":1},
        "RiverAccumulationThreshold":{"kind":"relative-measure","fraction":6.25e-19,"dimension":3,"exponent":1}
    }})).expect("Declared glacier settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    pub ice_temperature_threshold: f64,
    pub minimum_ice_balance: f64,
    pub ice_transport_years: f64,
    pub frozen_lake_ice_advance_gradient: f64,
    pub glacier_grounding_fraction: f64,
    pub glacial_cut_per_speed: f64,
    pub mass_wasting_stable_gradient: f64,
    pub ice_altitude_balance: f64,
    pub ice_yield_height: f64,
    pub ice_ablation_step: f64,
    pub glacier_frozen_speed: f64,
    pub hillslope_length: f64,
    pub moraine_minimum_glacial_deposition: f64,
    pub u_valley_minimum_glacial_erosion: f64,
    pub mountain_elevation: f64,
    pub glacier_thickness_threshold: f64,
    pub landform_neighborhood_radius: f64,
    pub river_accumulation_threshold: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
}
