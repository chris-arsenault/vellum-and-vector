//! Manual authoring of real-scale maps: commands over published GIS features (ADR 0016).
//!
//! Commands are planned here as pure changes over loaded features; the map store loads the
//! features a command names, writes the change in one transaction and keeps the undo steps.
//! World and regional maps stay read-only.
mod buildings;
pub mod choices;
mod clearance;
pub mod context;
mod frontage;
mod junctions;
mod levels;
pub mod objects;
mod placing;
mod plan;
mod shapes;
mod town;

pub use choices::{AuthoringChoices, HexClass};
pub use clearance::{building_clear, covered, is_water, plot_under, street_clear};
pub use frontage::{
    frontage, holds_address, insert_junction, is_building, is_street, is_way, is_yard, readdress,
    renumber, street_of, Frontage, ADDRESS_KEYS, FRONTAGE_REACH, FRONTS,
};
pub use junctions::{attach, crosses, follow, is_junction, junctions, CARRIES, JOINS, SPANS};
pub use levels::{level_name, unlinked};
pub use placing::is_hex_layer;
pub use plan::{plan, Draft, EditTargets};
pub use shapes::{carry_widths, footprint, transform_geometry, widths_at};
pub use town::{Settlement, NAMING_WORK, PLACING_REACH};

use crate::{CreatorLayer, Geometry, Id, MapDescriptor, MapFeature, RealScale};
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
        creator_layer: Option<Id>,
    },
    /// New vertices for one feature; its identity and attributes stay, widths follow the line.
    Reshape {
        id: Id,
        geometry: Geometry,
    },
    /// Move, rotate and scale features about a point.
    Transform {
        ids: Vec<Id>,
        transform: Transform,
    },
    Duplicate {
        ids: Vec<Id>,
        offset: [f64; 2],
    },
    Delete {
        ids: Vec<Id>,
    },
    /// Set the name and attributes; a null attribute value removes the attribute.
    SetAttributes {
        ids: Vec<Id>,
        name: Option<String>,
        attributes: BTreeMap<String, Value>,
    },
    /// Copy the source's kind attributes (not its shape, place or layer) onto the targets.
    PasteStyle {
        source: Id,
        ids: Vec<Id>,
    },
    AddLayer {
        name: String,
    },
    RenameLayer {
        id: Id,
        name: String,
    },
    LockLayer {
        id: Id,
        locked: bool,
    },
    MoveToLayer {
        ids: Vec<Id>,
        layer: Id,
    },
    /// Move a layer's features into the layer beneath it and remove the layer.
    MergeDown {
        id: Id,
    },
    /// Remove a layer and its features.
    DeleteLayer {
        id: Id,
    },
    /// One object of a catalogue kind at its real size, centred on `at`, turned `rotation`
    /// degrees counter-clockwise and scaled by `scale`.
    Place {
        layer_id: String,
        kind: String,
        name: Option<String>,
        at: [f64; 2],
        rotation: f64,
        scale: f64,
        creator_layer: Option<Id>,
    },
    /// Fill an outline with objects of one kind, no two closer than `spacing` metres. Each
    /// object is its own feature and the whole scatter is one undo step; the same seed lays
    /// the same objects.
    Scatter {
        layer_id: String,
        kind: String,
        outline: Geometry,
        spacing: f64,
        seed: u32,
        creator_layer: Option<Id>,
    },
    /// A street of a class (`mainStreet`, `street`, `lane`, `alley`) with the class's width;
    /// its ends join the ways they meet. Unnamed, it is named from the settlement's culture.
    DrawStreet {
        road_class: String,
        geometry: Geometry,
        name: Option<String>,
        creator_layer: Option<Id>,
    },
    /// A building of a use placed at a point, fronting the nearest street on a plot of its
    /// own, or on the empty plot the point falls in. Unnamed, its keeper is named.
    PlaceBuilding {
        building_use: String,
        at: [f64; 2],
        name: Option<String>,
        creator_layer: Option<Id>,
    },
    /// On a structure map: a new floor above the top level, or a cellar below the lowest,
    /// with the outer walls of the level next to it.
    AddLevel {
        below: bool,
    },
    /// On a structure map: remove a level (never the ground floor) and all drawn on it.
    RemoveLevel {
        space_id: Id,
    },
    /// Link a stair, ladder or trapdoor to its landing on another level, or to a feature on
    /// another map.
    Connect {
        id: Id,
        target: crate::structure::ConnectionTarget,
    },
    Disconnect {
        id: Id,
        target: crate::structure::ConnectionTarget,
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
    pub changed: Vec<Id>,
    /// Features the edit made, in the order the command made them (a placed building, then
    /// its plot), so the editor can select what was made.
    #[serde(default)]
    pub created: Vec<Id>,
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
    /// The map's located spaces and published layers, when the step changed them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spaces: Option<SpaceLayout>,
}
/// A map's located spaces and published layers, as one edit leaves them: a structure map's
/// levels, or a ground map's underground space opened by its first cave wall. Layers that
/// stay keep their feature counts; layers new to the map count the features the edit adds.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpaceLayout {
    pub spaces: Vec<crate::MapSpace>,
    pub layers: Vec<crate::MapLayer>,
}
impl SpaceLayout {
    pub fn of(map: &MapDescriptor) -> Self {
        Self {
            spaces: map.spaces.clone(),
            layers: map.layers.clone(),
        }
    }
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
// owner-direction(2026-11-21): authoring of every level, world, region and city, starting from a blank all-ocean map; the same operations for agents over MCP
pub fn editable(map: &MapDescriptor) -> Result<&RealScale, String> {
    map.real_scale.as_ref().ok_or_else(|| {
        "Only real-scale and authored maps can be edited; generated world and regional maps are read-only".into()
    })
}

/// Published layers a creator draws into, and the shape their features take.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    Line,
    Area,
}
/// The kind of layer a published layer id names: without the `vector:` prefix and without
/// the `@<level>` suffix that a structure map's upper floors and cellars carry, so
/// `vector:structures@-1` (a cellar's walls and doors) is a `structures` layer.
pub fn family(layer_id: &str) -> &str {
    let id = layer_id.strip_prefix("vector:").unwrap_or(layer_id);
    id.split_once('@').map_or(id, |(family, _)| family)
}
/// The shape one kind takes in a layer. Walls are lines with a thickness at each vertex
/// (`widths`) even in the structures layer, whose buildings, doors and furniture are outlines.
pub fn shape_of_kind(layer_id: &str, kind: &str) -> Option<Shape> {
    match (family(layer_id), kind) {
        ("structures", "wall") => Some(Shape::Line),
        _ => shape_of(layer_id),
    }
}
pub fn shape_of(layer_id: &str) -> Option<Shape> {
    match family(layer_id) {
        "rivers" | "roads" | "waterworks" | "caveWalls" => Some(Shape::Line),
        "lakes" | "oceans" | "landmasses" | "plots" | "structures" | "ruins" | "objects" => {
            Some(Shape::Area)
        }
        _ => None,
    }
}
/// The creator layer a feature belongs to; features that name none belong to the first.
/// A hex grid is derived from the map, not drawn into a creator layer, so a hex belongs to
/// none and no creator-layer lock holds it.
/// The creator layer a feature belongs to; hexes belong to none.
pub fn creator_layer(feature: &MapFeature, real: &RealScale) -> Option<Id> {
    if is_hex_layer(&feature.layer_id) {
        return None;
    }
    feature
        .attributes
        .get("creatorLayer")
        .and_then(Value::as_str)
        .and_then(|id| id.parse().ok())
        .or_else(|| real.creator_layers.first().map(|layer| layer.id))
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
        .any(|entry| Some(entry.id) == layer && entry.locked)
}

pub fn declarations(cfg: &ts_rs::Config) -> Vec<String> {
    vec![
        EditCommand::decl(cfg),
        Transform::decl(cfg),
        EditOutcome::decl(cfg),
        EditHistory::decl(cfg),
        EditStep::decl(cfg),
        AuthoringChoices::decl(cfg),
        HexClass::decl(cfg),
    ]
}
