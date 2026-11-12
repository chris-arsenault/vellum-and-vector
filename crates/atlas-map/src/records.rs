use crate::{Geometry, MapRef, Position, RegionGeometry};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapFeature {
    pub id: String,
    pub entity_id: Option<String>,
    pub layer_id: String,
    pub name: Option<String>,
    pub geometry: Geometry,
    pub attributes: BTreeMap<String, Value>,
    pub related_ids: Vec<String>,
}

/// Values retain stored sample geography independently of display interpolation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SampleValue {
    pub layer_id: String,
    pub band_id: String,
    pub value: Option<Value>,
    pub unit: String,
    pub category: Option<String>,
    pub footprint: RegionGeometry,
    pub cell_span: f64,
}

/// Published structured descriptions support rock, people and future catalogue sections.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InspectionSection {
    pub id: String,
    pub title: String,
    pub records: Vec<BTreeMap<String, Value>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Inspection {
    pub reference: MapRef,
    pub space_id: String,
    pub position: Position,
    pub samples: Vec<SampleValue>,
    pub features: Vec<MapFeature>,
    pub sections: Vec<InspectionSection>,
    pub causes: Vec<HistoryEntry>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryEntry {
    pub id: String,
    pub title: String,
    pub description: String,
    pub epoch: Option<f64>,
    pub feature_ids: Vec<String>,
    pub attributes: BTreeMap<String, Value>,
}
