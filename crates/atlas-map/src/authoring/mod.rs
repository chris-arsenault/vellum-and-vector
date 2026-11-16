//! Manual authoring of real-scale maps: commands over published GIS features (ADR 0016).
//!
//! Commands are planned here as pure changes over loaded features; the map store loads the
//! features a command names, writes the change in one transaction and keeps the undo steps.
//! World and regional maps stay read-only.
mod junctions;
mod plan;
mod shapes;

pub use junctions::{attach, crosses, follow, is_junction, junctions, CARRIES, JOINS, SPANS};
pub use plan::{plan, Draft, EditTargets};
pub use shapes::{carry_widths, footprint, transform_geometry, widths_at};

use crate::{CreatorLayer, Geometry, MapDescriptor, MapFeature, RealScale};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use ts_rs::TS;

/// One creator action. Each command is one undo step.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "command",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum EditCommand {
    /// A new feature of a catalogue kind in a published layer.
    Create {
        layer_id: String,
        kind: String,
        name: Option<String>,
        geometry: Geometry,
        attributes: BTreeMap<String, Value>,
        creator_layer: Option<String>,
    },
    /// New vertices for one feature; its identity and attributes stay, widths follow the line.
    Reshape {
        id: String,
        geometry: Geometry,
    },
    /// Move, rotate and scale features about a point.
    Transform {
        ids: Vec<String>,
        transform: Transform,
    },
    Duplicate {
        ids: Vec<String>,
        offset: [f64; 2],
    },
    Delete {
        ids: Vec<String>,
    },
    /// Set the name and attributes; a null attribute value removes the attribute.
    SetAttributes {
        ids: Vec<String>,
        name: Option<String>,
        attributes: BTreeMap<String, Value>,
    },
    /// Copy the source's kind attributes (not its shape, place or layer) onto the targets.
    PasteStyle {
        source: String,
        ids: Vec<String>,
    },
    AddLayer {
        name: String,
    },
    RenameLayer {
        id: String,
        name: String,
    },
    LockLayer {
        id: String,
        locked: bool,
    },
    MoveToLayer {
        ids: Vec<String>,
        layer: String,
    },
    /// Move a layer's features into the layer beneath it and remove the layer.
    MergeDown {
        id: String,
    },
    /// Remove a layer and its features.
    DeleteLayer {
        id: String,
    },
}

/// Translate after rotating (degrees counter-clockwise) and scaling about `about`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Transform {
    pub translate: [f64; 2],
    pub rotate: f64,
    pub scale: f64,
    pub about: [f64; 2],
}

/// The map after an edit, the features it touched and the undo steps that remain.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditOutcome {
    pub map: MapDescriptor,
    pub changed: Vec<String>,
    pub history: EditHistory,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditHistory {
    pub steps: Vec<EditStep>,
}
/// An undo step, named by what it did ("Move Glen burn").
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditStep {
    pub sequence: u32,
    pub label: String,
    pub undone: bool,
}
/// One side of a stored undo step: the features as they stood, and the creator layers when
/// the step changed them.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditSide {
    pub features: Vec<MapFeature>,
    pub layers: Option<Vec<CreatorLayer>>,
}
/// A stored undo step. Undo writes `before` over `after`; redo writes `after` again.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditRecord {
    pub label: String,
    pub before: EditSide,
    pub after: EditSide,
}

/// The real-scale block of a map that accepts edits.
// owner-direction(2026-11-16): its time to introduce manual authoring for real scale only
pub fn editable(map: &MapDescriptor) -> Result<&RealScale, String> {
    map.real_scale.as_ref().ok_or_else(|| {
        "Only real-scale maps can be edited; world and regional maps are read-only".into()
    })
}

/// Published layers a creator draws into, and the shape their features take.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    Line,
    Area,
}
pub fn shape_of(layer_id: &str) -> Option<Shape> {
    match layer_id.strip_prefix("vector:").unwrap_or(layer_id) {
        "rivers" | "roads" | "waterworks" => Some(Shape::Line),
        "lakes" | "oceans" | "plots" | "structures" | "ruins" | "objects" => Some(Shape::Area),
        _ => None,
    }
}
/// The creator layer a feature belongs to; features that name none belong to the first.
pub fn creator_layer<'a>(feature: &'a MapFeature, real: &'a RealScale) -> &'a str {
    feature
        .attributes
        .get("creatorLayer")
        .and_then(Value::as_str)
        .or_else(|| real.creator_layers.first().map(|layer| layer.id.as_str()))
        .unwrap_or_default()
}
/// A feature locked on its own or through its creator layer refuses pointer edits.
pub fn locked(feature: &MapFeature, real: &RealScale) -> bool {
    feature.attributes.get("locked") == Some(&Value::Bool(true)) || in_locked_layer(feature, real)
}
/// A locked creator layer refuses every edit to its features until it is unlocked.
pub fn in_locked_layer(feature: &MapFeature, real: &RealScale) -> bool {
    let layer = creator_layer(feature, real);
    real.creator_layers
        .iter()
        .any(|entry| entry.id == layer && entry.locked)
}

pub fn declarations(cfg: &ts_rs::Config) -> Vec<String> {
    vec![
        EditCommand::decl(cfg),
        Transform::decl(cfg),
        EditOutcome::decl(cfg),
        EditHistory::decl(cfg),
        EditStep::decl(cfg),
    ]
}
