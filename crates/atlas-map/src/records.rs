use crate::{Bounds, DisplayUnit, Geometry, MapRef, Position, RegionGeometry};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapFeature {
    pub id: String,
    pub space_id: String,
    pub entity_id: Option<String>,
    pub layer_id: String,
    pub name: Option<String>,
    pub kind: String,
    pub type_id: String,
    pub catalog: MapFeatureCatalog,
    pub geometry: Geometry,
    pub footprint: Option<RegionGeometry>,
    pub attributes: BTreeMap<String, Value>,
    pub relations: Vec<MapRelation>,
    pub causes: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapRelation {
    pub target_id: String,
    pub target_name: String,
    pub kind: String,
}

/// Resolved registry and origin facts; these are map descriptions, not generation records.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapFeatureCatalog {
    pub values: BTreeMap<String, Value>,
    pub columns: Vec<MapColumn>,
    pub origin: String,
    pub map_only: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapColumn {
    pub key: String,
    pub label: String,
    pub numeric: bool,
}

/// Named map entities used by settlement descriptions. Generation settings remain private.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapEntity {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub people: Option<f64>,
    pub places: Option<f64>,
}

/// Finished illustration geometry: a feature override, or an ocean when feature_id is absent.
/// A null feature geometry means that clipping removed the feature from the drawn map.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IllustrationGeometry {
    pub feature_id: Option<String>,
    pub geometry: Option<Geometry>,
}

/// Values retain stored sample geography independently of display interpolation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SampleValue {
    pub sample_id: String,
    pub layer_id: String,
    pub band_id: String,
    pub value: Option<Value>,
    pub unit: String,
    pub label: String,
    pub display: DisplayUnit,
    pub category: Option<String>,
    pub footprint: RegionGeometry,
    pub bounds: Bounds,
    pub cell_span: f64,
    pub center: Position,
    pub measure: f64,
    pub active: bool,
}

/// Attributes share one stored geographic sample footprint. No generation resource is referenced.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SampleAttribute {
    pub layer_id: String,
    pub band_id: String,
    pub value: Option<Value>,
    pub unit: String,
    pub label: String,
    pub display: DisplayUnit,
    pub category: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapSample {
    pub id: String,
    pub space_id: String,
    pub footprint: RegionGeometry,
    pub window: SampleWindow,
    pub cell_span: f64,
    pub center: Position,
    /// Area represented by this sample, in square coordinate units.
    pub measure: f64,
    pub active: bool,
    pub attributes: Vec<SampleAttribute>,
    pub sections: Vec<InspectionSection>,
}

/// Rectangular sample ownership in its continuous map chart. West and south are inclusive;
/// east and north are exclusive except at the outside edge of a sampled map.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SampleWindow {
    pub bounds: Bounds,
    pub closed_east: bool,
    pub closed_north: bool,
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
