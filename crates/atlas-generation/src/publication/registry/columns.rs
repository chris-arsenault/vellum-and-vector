use crate::publication::catalogue::Layer;
use atlas_map::MapColumn;
use serde_json::Value;
// hpc-exempt: named registry columns, entity identities and scalar descriptions, not numerical field storage.
use std::{collections::BTreeMap, sync::OnceLock};

const CORE: [(&str, &str); 10] = [
    ("name", "Name"),
    ("type", "Feature type"),
    ("map", "Mapped context"),
    ("profile", "Profile"),
    ("status", "Status"),
    ("state", "Authorship"),
    ("space", "Located space"),
    ("floor", "Floor"),
    ("protected", "Protected"),
    ("layer", "Logical layer"),
];
// hpc-exempt: named registry columns, entity identities and scalar descriptions, not numerical field storage.
fn labels() -> &'static BTreeMap<String, String> {
    // hpc-exempt: named registry columns, entity identities and scalar descriptions, not numerical field storage.
    static LABELS: OnceLock<BTreeMap<String, String>> = OnceLock::new();
    LABELS.get_or_init(|| {
        serde_json::from_str(include_str!("labels.json")).expect("Static column labels")
    })
}
fn hidden(key: &str) -> bool {
    key.ends_with("Id")
        || key == "magnitudeUnit"
        || [
            "naming",
            "namedIn",
            "nameStatus",
            "sourceAlgorithm",
            "spaceLabel",
            "representative",
            "center",
        ]
        .iter()
        .any(|p| key.starts_with(p))
}
/// Display units leave publication with the record; viewers do not know work mechanics.
pub fn work_unit(kind: &str) -> Option<&'static str> {
    Some(match kind {
        "clearance" | "burning" | "hunting" | "conservation" | "tapping" | "quarrying" => {
            "fraction"
        }
        "irrigation" | "dam" | "mill" => "cubic-metre/second",
        "harbor" | "pass" | "ford" | "bridge" => "people",
        "weir" => "metre",
        "fire-forge" => "celsius",
        "aurora-archive" => "crystal",
        "pressure-diving" => "charge",
        _ => return None,
    })
}
fn label(key: &str) -> String {
    if let Some(label) = labels().get(key) {
        return label.clone();
    }
    let mut result = String::new();
    let mut lower = false;
    for character in key.chars() {
        if lower && character.is_ascii_uppercase() {
            result.push(' ');
        }
        lower = character.is_ascii_lowercase();
        result.push(character);
    }
    result
}
pub fn columns(
    // hpc-exempt: named registry columns, entity identities and scalar descriptions, not numerical field storage.
    values: &BTreeMap<String, Value>,
    // hpc-exempt: named registry columns, entity identities and scalar descriptions, not numerical field storage.
    layers: &BTreeMap<String, Layer>,
) -> Vec<MapColumn> {
    let mut result = CORE
        .iter()
        .map(|(key, label)| MapColumn {
            key: (*key).into(),
            label: (*label).into(),
            numeric: false,
        })
        .collect::<Vec<_>>();
    for (key, value) in values {
        if hidden(key) || CORE.iter().any(|(core, _)| *core == key) {
            continue;
        }
        let custom = layers
            .values()
            .filter_map(|layer| layer.schema.get(key))
            .next_back();
        result.push(MapColumn {
            key: key.clone(),
            label: label(key),
            numeric: value.is_number() || custom.is_some_and(|spec| spec["type"] == "number"),
        });
    }
    result
}
