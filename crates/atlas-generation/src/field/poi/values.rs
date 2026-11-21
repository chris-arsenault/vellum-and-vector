use super::kinds::{AreaKind, Kind};
use crate::features::Feature;
use crate::{
    field::shared::{CellCode, Flag, FloatField, Scalar},
    human::HumanField,
    rock::ground::GroundField,
};
use serde::{Deserialize, Serialize};

/// Unspecified catalogue work is distinct from a role explicitly ruled out by its definition.
pub enum Slot<T> {
    Value(T),
    Unwritten,
    NotApplicable(&'static str),
}
impl<T> Slot<T> {
    pub fn value(&self) -> Option<&T> {
        if let Self::Value(value) = self {
            Some(value)
        } else {
            None
        }
    }
}
pub enum Must<T> {
    Value(T),
    Unwritten,
}
impl<T> Must<T> {
    pub fn value(&self) -> Option<&T> {
        if let Self::Value(value) = self {
            Some(value)
        } else {
            None
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostLink {
    pub host: AreaKind,
    pub host_id: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Place {
    pub hosted_by: Option<HostLink>,
    pub id: String,
    pub kind: Kind,
    pub cells: Vec<usize>,
    pub anchor: usize,
    pub feature: Option<Feature>,
    pub origin: Option<String>,
}
impl Place {
    pub fn at(kind: Kind, anchor: usize, cells: Vec<usize>) -> Self {
        Self {
            hosted_by: None,
            id: format!("{}:{anchor}", kind.as_str()),
            kind,
            cells,
            anchor,
            feature: None,
            origin: None,
        }
    }
}
#[derive(Clone)]
pub struct Found {
    pub anchor: usize,
    pub cells: Option<Vec<usize>>,
    pub hosted_by: Option<HostLink>,
}
#[derive(Clone)]
pub struct Claim {
    pub found: Found,
    pub origin: String,
}
pub struct LandformMark {
    pub code: i32,
    pub yields_to: Vec<i32>,
}
pub enum ExistenceWay {
    Emerges,
    Sited,
    Both,
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Moment {
    Geography,
    Magic,
    Society,
    /// A real-scale map's channels are drawn at their real size (ADR 0016).
    Ground,
}
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize)]
pub enum MagicBand {
    Channel {
        system: String,
        channel: MagicChannel,
    },
    Stock {
        system: String,
        stock: String,
    },
}
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize)]
pub enum MagicChannel {
    Intensity,
    Source,
    History,
    Wild,
    Stored,
}
#[derive(Clone, Copy)]
pub enum Change {
    Add(f64),
    AtMost(f64),
    AtLeast(f64),
}
#[derive(Clone)]
pub enum PhysicalBand {
    Scalar(Scalar),
    Code(CellCode),
    Float(FloatField),
    Flag(Flag),
    Ground(GroundField),
    Human(HumanField),
    SoilWater,
    WaterSurfaceElevations,
    RiverDepth,
}
#[derive(Clone)]
pub struct PhysicalChange {
    pub band: PhysicalBand,
    pub cell: usize,
    pub change: Change,
}
#[derive(Clone)]
pub enum FieldChange {
    WaterPassage {
        cell: usize,
        withdrawal: f64,
        transmission: f64,
    },
    Physical(PhysicalChange),
    Magic {
        band: MagicBand,
        cell: usize,
        change: Change,
    },
    GradeGround {
        cell: usize,
        gradient: f64,
    },
}
#[derive(Clone)]
pub struct Carried {
    pub feature: Feature,
    pub cell: usize,
    pub cells: Vec<usize>,
}
pub enum Unrealized {
    Keep,
    Move(usize),
    Drop,
}
pub struct Cost {
    pub cell: usize,
    pub factor: f64,
}
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Carrier {
    Crust,
    Roots,
    River,
    Wind,
    Current,
    Ice,
    People,
}
pub struct Link {
    pub a: usize,
    pub b: usize,
    /// What going through costs walkers, in steps of the map.
    pub steps: f64,
}
pub enum Barrier {
    River,
    Ridge,
    Strait,
    Wetland,
    Ice,
    Ward,
}
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Benefit {
    Water,
    Food,
    Power,
    Defence,
    Trade,
    Materials,
    Sanctity,
    /// Authority: the seat a realm is governed from. Power is mills, falls and furnaces.
    Rule,
}
impl Benefit {
    pub const ALL: [Self; 8] = [
        Self::Water,
        Self::Food,
        Self::Power,
        Self::Defence,
        Self::Trade,
        Self::Materials,
        Self::Sanctity,
        Self::Rule,
    ];
}
pub struct Hazard {
    pub hazard: String,
    pub reach: f64,
    pub severity: f64,
}
pub enum Fate {
    Persists,
    Becomes(Kind),
    Ends { leaves: Option<Kind> },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NameKind {
    Landform,
}
#[derive(Serialize)]
pub struct NameTerm {
    pub kind: NameKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subkind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub term: Option<String>,
}
#[derive(Serialize)]
pub struct Size {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub length: Option<f64>,
}
