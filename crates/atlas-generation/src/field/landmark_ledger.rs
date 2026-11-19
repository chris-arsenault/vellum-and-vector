use serde::{Deserialize, Serialize};
// hpc-exempt: sparse named measures on landmark records match the source catalogue.
use std::collections::BTreeMap;

#[derive(Clone, Serialize, Deserialize)]
pub struct Capture {
    pub x: f64,
    pub y: f64,
    pub accumulation: f64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LandmarkRecord {
    pub id: atlas_map::Id,
    pub kind: String,
    pub realized: bool,
    pub emplaced_at_epoch: i32,
    // hpc-exempt: a named landmark's declared measures, not cell storage.
    pub target: BTreeMap<String, f64>,
    // hpc-exempt: a named landmark's measured signature, not cell storage.
    pub measured: BTreeMap<String, f64>,
    pub maintenance: f64,
    pub strength: Option<f64>,
    pub capture: Option<Capture>,
    pub corridor: Vec<u32>,
    pub notes: Vec<String>,
}
impl LandmarkRecord {
    pub fn note(&mut self, text: &str) {
        if self.notes.last().is_none_or(|last| last != text) {
            self.notes.push(text.into());
        }
    }
}
