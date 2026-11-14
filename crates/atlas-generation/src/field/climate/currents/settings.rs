use super::super::settings;
use crate::scale_settings::{ResolvedSettings, ScaleDefinition};
use serde::Deserialize;
pub fn settings() -> ScaleDefinition {
    let length = |fraction| serde_json::json!({"kind":"relative-measure","fraction":fraction,"dimension":1,"exponent":1});
    let currents =
        ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
            "OceanCurrentSmoothingLength":length(0.00625),"GyreCoastalLength":length(0.05),
            "GyreBoundaryStrength":0.8,"SeaSurfaceRelaxation":length(0.3),"UpwellingCooling":60,
            "SeaSurfaceMixing":length(0.0625),"OceanCurrentHeatDistance":length(0.025),
            "OceanCurrentHeatCooling":50,"OceanCurrentFetchDistance":length(0.045),
            "OceanCurrentMinimumStrength":110,"ShelfBreakDepth":length(0.0001075)
        }}))
        .expect("Declared ocean current settings");
    ScaleDefinition::combine([settings::settings(), currents])
        .expect("Named ocean current settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    #[serde(flatten)]
    pub atmosphere: settings::Settings,
    pub ocean_current_smoothing_length: f64,
    pub gyre_coastal_length: f64,
    pub gyre_boundary_strength: f64,
    pub sea_surface_relaxation: f64,
    pub upwelling_cooling: f64,
    pub sea_surface_mixing: f64,
    pub ocean_current_heat_distance: f64,
    pub ocean_current_heat_cooling: f64,
    pub ocean_current_fetch_distance: f64,
    pub ocean_current_minimum_strength: f64,
    pub shelf_break_depth: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
}
