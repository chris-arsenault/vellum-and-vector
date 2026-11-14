use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EventKind {
    Impact,
    Plume,
    Volcano,
    Landmark,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub kind: EventKind,
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    pub epoch: i32,
    pub strength: f64,
    pub caldera: Option<bool>,
}
