use crate::{
    climate::{LatitudeFrame, LatitudeProjection, RainBelts},
    scale_settings::{ResolvedSettings, ScaleDefinition},
};
use serde::Deserialize;
pub fn settings() -> ScaleDefinition {
    let length = |fraction| serde_json::json!({"kind":"relative-measure","fraction":fraction,"dimension":1,"exponent":1});
    let mm = |fraction| serde_json::json!({"kind":"relative-measure","fraction":fraction,"dimension":1,"exponent":1,"unit":"mm"});
    let mut values = serde_json::json!({
        "LatitudeSouth":10,"LatitudeNorth":70,"LatitudeProjection":1,"WrapLongitude":0,
        "WorldExtentY":null,"WorldExtentX":null,
        "TemperatureBaseline":285,"InsolationTemperatureRange":280,"ElevationTemperatureLapse":65,
        "ElevationScale":length(0.00025),
        "SeasonalityEquator":1.5,"SeasonalityPolar":22,"MaritimeSeasonality":0.35,
        "ContinentalityDistance":length(0.25),"GeothermalSurfaceThreshold":0,
        "GeothermalTemperatureStrength":310,"OceanCurrentTemperatureStrength":150,
        "PrecipitationBaseline":mm(1e-8),"FogDrip":mm(7.5e-8),"FogCooling":20,
        "AxialTilt":23.5,"SnowTemperatureThreshold":300,"SnowTemperatureTransition":100,
        "CirculationCellsPerHemisphere":3,"CirculationCellTurn":700,"CirculationWander":550,
        "CirculationWanderScale":length(0.105),
        "WindSpeedTrades":length(0.00000175),"WindSpeedWesterlies":length(0.00000225),
        "WindSpeedPolar":length(0.00000125),"WindLandRoughness":0.75,
        "WindTerrainLength":length(0.01),"WindBlockingHeight":length(0.000375),
        "WindBlockingSlope":0.01,"WindBlockingMaximum":0.6,
        "WindExposureRelief":length(0.00015),"WindShelterHeight":length(0.00025),
        "WindGapReach":length(0.00625),"WindGapRelief":length(0.000075)
    });
    let columns = serde_json::json!({
        "ColumnSaturation":mm(4.125e-7),"ColumnSaturationGrowth":0.045,
        "OceanColumnHumidity":0.85,"BoundaryColumnHumidity":0.5,
        "SeaEvaporationLength":length(0.1),"SeaExchangeLength":length(0.075),
        "ColumnRainLength":length(0.25),"ColumnRainEfficiency":0.8,
        "OrographicLiftHeight":length(0.001),"AirHeatLength":length(0.25),"MaritimeLength":length(0.2),
        "MagicHeatAirLength":length(0.075),"MagicHeatAirShare":0.5,"MagicHeatAirSpread":length(0.015),
        "MagicSteamShare":0.6,"MagicLiftHeat":250,"StormLength":length(0.1),
        "StormPinning":0.8,"StormMoistureShare":0.8,"StormLift":0.5,"StormDeflection":0.8,
        "EquatorialConvergence":1.2,"EquatorialConvergenceWidth":15,
        "StormTrackStrength":1.2,"SubtropicalSubsidence":1.1,"SubtropicalSubsidenceWidth":10,
        "PolarSubsidence":0.7,"MinimumRainout":0.08
    });
    values
        .as_object_mut()
        .unwrap()
        .extend(columns.as_object().unwrap().clone());
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":values}))
        .expect("Declared atmospheric settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    pub latitude_south: f64,
    pub latitude_north: f64,
    pub latitude_projection: i32,
    pub wrap_longitude: i32,
    pub world_extent_y: Option<[f64; 2]>,
    pub world_extent_x: Option<[f64; 2]>,
    pub temperature_baseline: f64,
    pub insolation_temperature_range: f64,
    pub elevation_temperature_lapse: f64,
    pub elevation_scale: f64,
    pub seasonality_equator: f64,
    pub seasonality_polar: f64,
    pub maritime_seasonality: f64,
    pub continentality_distance: f64,
    pub geothermal_surface_threshold: f64,
    pub geothermal_temperature_strength: f64,
    pub ocean_current_temperature_strength: f64,
    pub precipitation_baseline: f64,
    pub fog_drip: f64,
    pub fog_cooling: f64,
    pub axial_tilt: f64,
    pub snow_temperature_threshold: f64,
    pub snow_temperature_transition: f64,
    pub circulation_cells_per_hemisphere: f64,
    pub circulation_cell_turn: f64,
    pub circulation_wander: f64,
    pub circulation_wander_scale: f64,
    pub wind_speed_trades: f64,
    pub wind_speed_westerlies: f64,
    pub wind_speed_polar: f64,
    pub wind_land_roughness: f64,
    pub wind_terrain_length: f64,
    pub wind_blocking_height: f64,
    pub wind_blocking_slope: f64,
    pub wind_blocking_maximum: f64,
    pub wind_exposure_relief: f64,
    pub wind_shelter_height: f64,
    pub wind_gap_reach: f64,
    pub wind_gap_relief: f64,
    pub column_saturation: f64,
    pub column_saturation_growth: f64,
    pub ocean_column_humidity: f64,
    pub boundary_column_humidity: f64,
    pub sea_evaporation_length: f64,
    pub sea_exchange_length: f64,
    pub column_rain_length: f64,
    pub column_rain_efficiency: f64,
    pub orographic_lift_height: f64,
    pub air_heat_length: f64,
    pub maritime_length: f64,
    pub magic_heat_air_length: f64,
    pub magic_heat_air_share: f64,
    pub magic_heat_air_spread: f64,
    pub magic_steam_share: f64,
    pub magic_lift_heat: f64,
    pub storm_length: f64,
    pub storm_pinning: f64,
    pub storm_moisture_share: f64,
    pub storm_lift: f64,
    pub storm_deflection: f64,
    pub equatorial_convergence: f64,
    pub equatorial_convergence_width: f64,
    pub storm_track_strength: f64,
    pub subtropical_subsidence: f64,
    pub subtropical_subsidence_width: f64,
    pub polar_subsidence: f64,
    pub minimum_rainout: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
    pub fn latitude(&self) -> LatitudeFrame {
        LatitudeFrame {
            south: self.latitude_south,
            north: self.latitude_north,
            projection: if self.latitude_projection == 1 {
                LatitudeProjection::EqualArea
            } else {
                LatitudeProjection::Equirectangular
            },
            world_extent_y: self.world_extent_y,
        }
    }
    pub fn belts(&self) -> RainBelts {
        RainBelts {
            axial_tilt: self.axial_tilt,
            circulation_cells_per_hemisphere: self.circulation_cells_per_hemisphere,
            equatorial_convergence: self.equatorial_convergence,
            equatorial_convergence_width: self.equatorial_convergence_width,
            storm_track_strength: self.storm_track_strength,
            subtropical_subsidence: self.subtropical_subsidence,
            subtropical_subsidence_width: self.subtropical_subsidence_width,
            polar_subsidence: self.polar_subsidence,
            minimum_rainout: self.minimum_rainout,
        }
    }
}
