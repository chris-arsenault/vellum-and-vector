use crate::{
    field::{climate, landforms},
    scale_settings::ResolvedSettings,
};
use serde::Deserialize;
use std::io;

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Relief {
    pub shelf_break_depth: f64,
    pub relief_radius: f64,
    pub mountain_elevation: f64,
    pub hill_elevation: f64,
    pub mountain_local_relief: f64,
    pub range_minimum_area: f64,
    pub mantle_plume_radius: f64,
    pub impact_visible_relief: f64,
    pub fracture_width: f64,
    pub impact_fracture_strength: f64,
    pub open_bed_seepage: f64,
}
pub struct Settings {
    pub profile: ResolvedSettings,
    pub climate: climate::settings::Settings,
    pub landforms: landforms::Settings,
    pub glaciers: crate::field::glaciers::Settings,
    pub relief: Relief,
    pub magic: Magic,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Magic {
    pub fracture_conductance_floor: f64,
    storm_scour: f64,
    dune_mobility: f64,
}
impl Magic {
    pub fn weather(&self) -> crate::magic::weather::Settings {
        crate::magic::weather::Settings {
            storm_scour: self.storm_scour,
            dune_mobility: self.dune_mobility,
        }
    }
}
impl Settings {
    pub fn new(physical: &ResolvedSettings, climate: &ResolvedSettings) -> io::Result<Self> {
        Ok(Self {
            profile: physical.clone(),
            climate: climate::settings::Settings::from_resolved(climate)?,
            landforms: landforms::Settings::from_resolved(physical)?,
            glaciers: crate::field::glaciers::Settings::from_resolved(physical)?,
            relief: serde_json::from_value(physical.values().clone())?,
            magic: serde_json::from_value(physical.values().clone())?,
        })
    }
}
