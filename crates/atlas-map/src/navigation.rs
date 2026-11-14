use crate::{Bounds, Geometry, MapRef, Position, RegionGeometry};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

/// Scale rules resolved at publication, expressed in the map's coordinate units.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegionScale {
    pub level: u32,
    pub next_area: f64,
    pub subdivision: f64,
    pub minimum_width: f64,
    pub enabled: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapRegion {
    pub id: String,
    pub name: String,
    pub space_id: String,
    pub parent_id: Option<String>,
    pub geometry: RegionGeometry,
    pub child: Option<MapRef>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapView {
    pub id: String,
    pub name: String,
    pub region_id: Option<String>,
    pub settings: BTreeMap<String, serde_json::Value>,
}

/// Presentation changes do not revise the immutable geography or captured generation inputs.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapNavigationState {
    pub version: u32,
    pub regions: Vec<MapRegion>,
    pub views: Vec<MapView>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    content = "data",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum NavigationChange {
    AttachChild { region_id: String, child: MapRef },
    PutRegion(MapRegion),
    RemoveRegion(String),
    PutView(MapView),
    RemoveView(String),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegionQuery {
    pub space_id: String,
    pub parent_id: Option<String>,
    pub editing_id: Option<String>,
    pub position: Option<Position>,
    pub viewport: Bounds,
    pub cuts: Vec<Geometry>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegionCandidate {
    pub name: String,
    pub geometry: RegionGeometry,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegionChoices {
    pub version: u32,
    pub child_id: Option<String>,
    pub candidates: Vec<RegionCandidate>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegionDrawing {
    pub query: RegionQuery,
    pub geometry: Geometry,
    pub tolerance: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegionDrawingResult {
    pub version: u32,
    pub cuts: Vec<Geometry>,
    pub candidate: Option<RegionCandidate>,
    pub candidates: Vec<RegionCandidate>,
}
