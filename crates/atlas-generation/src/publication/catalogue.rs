//! Resolve feature labels and discovery groups while private configuration is available.
mod styles;
use crate::{
    features::records::Attributes,
    magic::{
        configuration::{Cartography, System},
        confluences::configuration::Confluence,
    },
};
use atlas_map::{MagicDepiction, MapFeatureType};
use serde::Deserialize;
// hpc-exempt: named feature classifications and layer presentation metadata, not numerical field storage.
use std::{collections::BTreeMap, sync::OnceLock};
pub use styles::{presets, style, Layer};

#[derive(Deserialize)]
struct Vocabulary {
    features: Vec<[String; 5]>,
    // hpc-exempt: named feature classifications and layer presentation metadata, not numerical field storage.
    landmarks: BTreeMap<String, String>,
    /// True sizes of kinds a creator places or draws at their size, keyed `layer:kind`; the
    /// one definition authoring reads from the published feature types.
    #[serde(default)]
    // hpc-exempt: named feature classifications and layer presentation metadata, not numerical field storage.
    sizes: BTreeMap<String, atlas_map::KindSize>,
}
/// The catalogue's true size of a kind in a layer, when it has one.
pub fn true_size(layer: &str, kind: &str) -> Option<atlas_map::KindSize> {
    vocabulary().sizes.get(&format!("{layer}:{kind}")).copied()
}
fn vocabulary() -> &'static Vocabulary {
    static VALUE: OnceLock<Vocabulary> = OnceLock::new();
    VALUE.get_or_init(|| {
        serde_json::from_str(include_str!("catalogue.json")).expect("Static feature vocabulary")
    })
}
pub struct Catalogue<'a> {
    // hpc-exempt: named feature classifications and layer presentation metadata, not numerical field storage.
    pub layers: &'a BTreeMap<String, Layer>,
    pub systems: &'a [System],
    pub confluences: &'a [Confluence],
}
fn text(attributes: &Attributes, key: &str) -> Option<String> {
    attributes
        .get(key)
        .filter(|value| !value.is_null())
        .map(|value| {
            value
                .as_str()
                .map_or_else(|| value.to_string(), String::from)
        })
}
impl Catalogue<'_> {
    pub fn describe(&self, layer: &str, kind: &str, attributes: &Attributes) -> MapFeatureType {
        let (id, path, magic_depiction) = if layer == "magic" && kind != "landmark" {
            self.magic(kind, attributes)
        } else {
            let definition = vocabulary()
                .features
                .iter()
                .find(|d| d[0] == kind && d[1] == layer);
            let mut path = definition.map_or_else(
                || {
                    vec![
                        "Custom".into(),
                        self.layers.get(layer).map_or(layer, |l| &l.name).into(),
                        kind.into(),
                    ]
                },
                |d| vec![d[3].clone(), d[4].clone(), d[2].clone()],
            );
            let subtype = subtype(layer, kind, attributes);
            if !subtype.is_empty() {
                path.push(subtype.clone());
            }
            (
                serde_json::json!([layer, kind, subtype]).to_string(),
                path,
                None,
            )
        };
        MapFeatureType {
            id,
            kind: kind.into(),
            label: path.last().cloned().unwrap_or_default(),
            path,
            magic_depiction,
            count: 0,
            geometries: Vec::new(),
            footprints: false,
            true_size: true_size(layer, kind),
        }
    }
    fn magic(
        &self,
        kind: &str,
        attributes: &Attributes,
    ) -> (String, Vec<String>, Option<MagicDepiction>) {
        let mut parts = kind.split(':');
        let system_id =
            text(attributes, "system").unwrap_or_else(|| parts.next().unwrap_or(kind).into());
        let rule_id = text(attributes, "rule")
            .unwrap_or_else(|| kind.split(':').nth(1).unwrap_or("source").into());
        let system = self.systems.iter().find(|s| s.id == system_id);
        let rule = system.and_then(|s| s.features.iter().find(|r| r.id == rule_id));
        let confluence = (system_id == "confluence")
            .then(|| self.confluences.iter().find(|c| c.id == rule_id))
            .flatten();
        let rule_name = confluence
            .map(|r| r.name.as_str())
            .or_else(|| rule.map(|r| r.name.as_str()));
        let interaction = confluence
            .map(|r| &r.seeds)
            .or_else(|| rule.map(|r| &r.seeds))
            .is_some_and(|seeds| {
                seeds
                    .iter()
                    .flatten()
                    .any(|c| c.field.starts_with("system:"))
            });
        let label = if kind == "magicSource" {
            "Authored sources"
        } else {
            rule_name.unwrap_or(&rule_id)
        };
        let family = if interaction || system_id == "confluence" {
            "Interactions"
        } else {
            system.map_or(system_id.as_str(), |s| s.name.as_str())
        };
        let depiction = rule
            .and_then(|rule| rule.cartography)
            .map(|value| match value {
                Cartography::Site => MagicDepiction::Site,
                Cartography::Course => MagicDepiction::Course,
                Cartography::Area => MagicDepiction::Area,
            });
        (
            serde_json::json!(["magic", system_id, rule_id]).to_string(),
            vec!["Magic".into(), family.into(), label.into()],
            depiction,
        )
    }
    // hpc-exempt: named feature classifications and layer presentation metadata, not numerical field storage.
    pub fn available(&self, layer: &str) -> BTreeMap<String, MapFeatureType> {
        // hpc-exempt: named feature classifications and layer presentation metadata, not numerical field storage.
        let mut types = BTreeMap::new();
        let mut add = |kind: &str, attributes: Attributes| {
            let value = self.describe(layer, kind, &attributes);
            types.insert(value.id.clone(), value);
        };
        for definition in &vocabulary().features {
            if definition[1] == layer && self.layers.contains_key(layer) {
                add(&definition[0], Attributes::new());
            }
        }
        if layer == "magic" {
            for system in self.systems {
                for rule in &system.features {
                    add(&format!("{}:{}", system.id, rule.id), Attributes::new());
                }
            }
            for confluence in self.confluences {
                add(&format!("confluence:{}", confluence.id), Attributes::new());
            }
        }
        types
    }
}
fn subtype(layer: &str, kind: &str, attributes: &Attributes) -> String {
    if kind == "settlement" && layer == "settlements" {
        let role = text(attributes, "settlementRole").unwrap_or_else(|| "settlement".into());
        return match role.as_str() {
            "capital" => "Capitals",
            "regionalCapital" => "Regional capitals",
            "marketTown" => "Market towns",
            "settlement" => "Other settlements",
            _ => &role,
        }
        .into();
    }
    let key = if layer == "ecology" {
        "biome"
    } else if kind == "societyEvent" {
        "eventKind"
    } else if kind == "landmark" {
        "landmarkKind"
    } else {
        return String::new();
    };
    let value = attributes
        .get(key)
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if kind == "landmark" {
        vocabulary()
            .landmarks
            .get(value)
            .map_or(value, String::as_str)
            .into()
    } else {
        value.into()
    }
}
