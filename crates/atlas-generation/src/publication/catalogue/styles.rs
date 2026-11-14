use crate::atlas::resolution::Profile;
use atlas_map::MapVectorStyle;
use serde::{Deserialize, Serialize};
use serde_json::Value;
// hpc-exempt: named feature classifications and layer presentation metadata, not numerical field storage.
use std::collections::BTreeMap;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub id: String,
    pub name: String,
    pub family: String,
    pub color: String,
    pub representation: String,
    pub representations: Option<Vec<String>>,
    pub profiles: Vec<Profile>,
    pub generator: Option<String>,
    pub facts: Option<Vec<String>>,
    // hpc-exempt: named feature classifications and layer presentation metadata, not numerical field storage.
    pub schema: BTreeMap<String, Value>,
}
impl Layer {
    pub fn vector(&self) -> bool {
        self.representations.as_ref().map_or_else(
            || matches!(self.representation.as_str(), "vector" | "network"),
            |values| {
                values
                    .iter()
                    .any(|value| matches!(value.as_str(), "vector" | "network"))
            },
        )
    }
}
pub fn style(layer: &Layer) -> MapVectorStyle {
    MapVectorStyle {
        visible: false,
        opacity: if layer.family == "political" {
            0.4
        } else {
            0.85
        },
        color: match layer.id.as_str() {
            "rivers" => "#397d99",
            "lakes" => "#83b6c5",
            "roads" => "#ac8553",
            "geology" => "#9b8c70",
            _ => &layer.color,
        }
        .into(),
        labels: matches!(layer.id.as_str(), "settlements" | "pois"),
        min_scale: 0.0,
        // hpc-exempt: named feature classifications and layer presentation metadata, not numerical field storage.
        types: BTreeMap::new(),
        // hpc-exempt: named feature classifications and layer presentation metadata, not numerical field storage.
        groups: BTreeMap::new(),
        symbols: None,
        filter: None,
    }
}
pub fn presets(layer: &Layer) -> Vec<String> {
    let overlay = match layer.id.as_str() {
        "waterworks" | "transportSites" | "landUse" => Some("infrastructure"),
        "magicPractices" => Some("magical"),
        "institutions" => Some("cultural"),
        "historicalEvents" | "ruins" | "faults" => Some(""),
        _ => None,
    };
    [
        "physical",
        "political",
        "cultural",
        "magical",
        "infrastructure",
    ]
    .into_iter()
    .filter(|preset| {
        if let Some(overlay) = overlay {
            return overlay == *preset;
        }
        let families: &[&str] = match *preset {
            "physical" | "infrastructure" => {
                &["physical", "water", "magic", "transport", "built", "custom"]
            }
            "political" => &["physical", "water", "political", "built"],
            "cultural" => &["physical", "water", "cultural", "built"],
            _ => &["physical", "water", "magic"],
        };
        families.contains(&layer.family.as_str())
    })
    .map(String::from)
    .collect()
}
