use serde::Deserialize;
// hpc-exempt: static channel labels and palette vocabulary, not numerical field storage.
use std::{collections::BTreeMap, sync::OnceLock};
#[derive(Deserialize)]
pub struct Name {
    pub label: String,
    pub theme: String,
    pub branch: String,
    #[serde(default)]
    pub common: bool,
    pub classes: Option<String>,
}
#[derive(Clone, Deserialize)]
pub struct Category {
    pub code: i32,
    pub name: String,
    pub color: String,
    pub bathymetric: bool,
    pub tint: f64,
}
#[derive(Deserialize)]
pub struct Biome {
    pub name: String,
    pub color: String,
}
#[derive(Deserialize)]
pub struct Craft {
    pub code: i32,
    pub system: String,
    pub name: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vocabulary {
    // hpc-exempt: static channel labels and palette vocabulary, not numerical field storage.
    pub names: BTreeMap<String, Name>,
    // hpc-exempt: static channel labels and palette vocabulary, not numerical field storage.
    pub ecology_labels: BTreeMap<String, String>,
    pub biomes: Vec<Biome>,
    pub rock: Vec<Category>,
    pub natural: Vec<Category>,
    pub crafts: Vec<Craft>,
    pub physical_materials: Vec<String>,
}
pub fn get() -> &'static Vocabulary {
    static VALUE: OnceLock<Vocabulary> = OnceLock::new();
    VALUE.get_or_init(|| {
        serde_json::from_str(include_str!("vocabulary.json")).expect("Static field vocabulary")
    })
}
