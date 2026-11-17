//! The structure-map vocabulary, declared once in `structure.json`: the shell's settings,
//! level names and which kinds connect and what they reach. Rust reads it here and the
//! contracts export the same file to the frontend.
use serde::Deserialize;
use std::{collections::BTreeMap, sync::OnceLock};

pub const VOCABULARY: &str = include_str!("structure.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vocabulary {
    pub shell: ShellSettings,
    pub levels: LevelNames,
    pub connections: Connections,
}
/// The generated shell: outer wall thickness and street door width in metres, the ground kept
/// around the footprint in hexes, and the ladder hex size floors open at.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellSettings {
    pub outer_wall: f64,
    pub street_door: f64,
    pub frame_margin_hexes: f64,
    pub hex_size: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelNames {
    names: BTreeMap<String, String>,
    cellar: String,
    floor: String,
    pub lowest: i32,
    pub highest: i32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connections {
    pub kinds: Vec<String>,
    pub landings: Vec<String>,
    pub reaches_layers: Vec<String>,
    pub reaches_structures: Vec<String>,
}
pub fn vocabulary() -> &'static Vocabulary {
    static PARSED: OnceLock<Vocabulary> = OnceLock::new();
    PARSED.get_or_init(|| serde_json::from_str(VOCABULARY).expect("structure.json is valid"))
}
impl LevelNames {
    pub fn name(&self, number: i32) -> String {
        if let Some(name) = self.names.get(&number.to_string()) {
            return name.clone();
        }
        let pattern = if number < 0 {
            &self.cellar
        } else {
            &self.floor
        };
        pattern.replace("{n}", &number.abs().to_string())
    }
}
