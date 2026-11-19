use atlas_map::{Geometry, Id};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

pub type Attributes = Map<String, Value>;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Entity {
    pub id: Id,
    pub name: String,
    pub kind: String,
    pub attributes: Attributes,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relations: Option<Vec<Relation>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<State>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum State {
    Unmaterialized,
    Generated,
    Authored,
    Protected,
    IntentionallyEmpty,
    Stale,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Relation {
    pub target_id: Id,
    pub kind: String,
}

/// Deferred authoring data remains part of the record without introducing editing operations.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapBaseline {
    pub geometry: Geometry,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub footprint: Option<Geometry>,
    pub attributes: Attributes,
    pub relations: Vec<Relation>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Representation {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_source: Option<Box<Representation>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_baseline: Option<MapBaseline>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub footprint: Option<Geometry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Id>,
    pub protected: bool,
    pub needs_reconciliation: bool,
    pub attributes: Option<Attributes>,
    pub geometry: Geometry,
    pub state: State,
    pub actor: String,
    pub generation_id: Option<Id>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Feature {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub place_id: Option<Id>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub footprint: Option<Geometry>,
    pub id: Id,
    pub name: String,
    pub kind: String,
    pub layer_id: String,
    pub area_id: Id,
    pub geometry: Geometry,
    /// The record's representation in each area that holds it, by area.
    pub detail: BTreeMap<Id, Representation>,
    pub attributes: Attributes,
    pub relations: Vec<Relation>,
    pub state: State,
    pub protected: bool,
    pub actor: String,
    pub generation_id: Option<Id>,
    pub causes: Vec<String>,
    pub generation_domain: Option<String>,
}
