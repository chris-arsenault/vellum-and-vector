use crate::scale_settings::{ResolvedSettings, ScaleDefinition};
use serde::Deserialize;
pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "FjordMinimumGlacialErosion":{"kind":"relative-measure","fraction":5e-7,"dimension":1,"exponent":1},
        "FjordMaximumHalfWidth":{"kind":"relative-measure","fraction":0.00375,"dimension":1,"exponent":1},
        "ImpactLandformMinimumRimUplift":{"kind":"relative-measure","fraction":0.000002,"dimension":1,"exponent":1},
        "ImpactLandformMinimumExcavation":{"kind":"relative-measure","fraction":0.0000045,"dimension":1,"exponent":1},
        "OutwashMinimumGlacialDeposition":{"kind":"relative-measure","fraction":0.0000015,"dimension":1,"exponent":1},
        "RidgeElevationThreshold":{"kind":"relative-measure","fraction":0.00025,"dimension":1,"exponent":1},
        "AncestralValleyMinimumErosion":{"kind":"relative-measure","fraction":0.00000125,"dimension":1,"exponent":1},
        "RiverAccumulationThreshold":{"kind":"relative-measure","fraction":6.25e-19,"dimension":3,"exponent":1},
        "GorgeMinimumIncision":{"kind":"relative-measure","fraction":0.000003,"dimension":1,"exponent":1},
        "LandformNeighborhoodRadius":{"kind":"relative-measure","fraction":0.0025,"dimension":1,"exponent":1},
        "PlainSlopeThreshold":0.003,"RidgeSlopeThreshold":0.0038,"GorgeMinimumSlope":0.009,"InheritedRidgeActivityThreshold":60
    }})).expect("Declared landform settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    pub fjord_minimum_glacial_erosion: f64,
    pub fjord_maximum_half_width: f64,
    pub impact_landform_minimum_rim_uplift: f64,
    pub impact_landform_minimum_excavation: f64,
    pub outwash_minimum_glacial_deposition: f64,
    pub ridge_elevation_threshold: f64,
    pub ancestral_valley_minimum_erosion: f64,
    pub river_accumulation_threshold: f64,
    pub gorge_minimum_incision: f64,
    pub landform_neighborhood_radius: f64,
    pub plain_slope_threshold: f64,
    pub ridge_slope_threshold: f64,
    pub gorge_minimum_slope: f64,
    pub inherited_ridge_activity_threshold: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
}
