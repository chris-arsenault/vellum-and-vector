use crate::{Bounds, DisplayUnit, Geometry, Id, MapRef, Position, RegionGeometry};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapFeature {
    pub id: Id,
    pub space_id: Id,
    pub entity_id: Option<Id>,
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
    pub target_id: Id,
    /// The map the target lies on, when it is not this map (a `connectsTo` to a parent map).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub target_map_id: Option<Id>,
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
    pub id: Id,
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
    pub feature_id: Option<Id>,
    pub geometry: Option<Geometry>,
}

/// A published raster band's value at one position, read from the map's GeoTIFF pixel.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BandValue {
    pub layer_id: String,
    pub band_id: String,
    pub value: f64,
    pub unit: String,
    pub label: String,
    pub display: DisplayUnit,
    /// The label of the band's class this value names, for categorical bands.
    pub category: Option<String>,
}

/// A generation cell's published footprint and its structured descriptions. Band values
/// live in the map's rasters, not here.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapSample {
    pub id: String,
    pub space_id: Id,
    pub footprint: RegionGeometry,
    pub window: SampleWindow,
    pub cell_span: f64,
    pub center: Position,
    /// Area represented by this sample, in square coordinate units.
    pub measure: f64,
    pub active: bool,
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
    pub space_id: Id,
    pub position: Position,
    /// The cells under the position, with their structured descriptions.
    pub samples: Vec<MapSample>,
    /// Every raster band's value at the position.
    pub values: Vec<BandValue>,
    pub features: Vec<MapFeature>,
    pub causes: Vec<HistoryEntry>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryEntry {
    pub id: Id,
    pub title: String,
    pub description: String,
    pub epoch: Option<f64>,
    pub feature_ids: Vec<Id>,
    pub attributes: BTreeMap<String, Value>,
}
