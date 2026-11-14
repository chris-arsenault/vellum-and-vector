mod classes;
mod metadata;
mod vocabulary;
use crate::{
    features::records::Entity,
    magic::{configuration::System, confluences::configuration::Confluence},
    scale::MapScale,
};
use atlas_map::{DisplayUnit, LayerCatalog};
pub use metadata::{input, inspection_band, layer_id};
// hpc-exempt: entity names and published layer metadata, not numerical field storage.
use std::collections::BTreeMap;

pub struct Fields<'a> {
    // hpc-exempt: entity names and published layer metadata, not numerical field storage.
    pub entities: &'a BTreeMap<String, Entity>,
    pub systems: &'a [System],
    pub confluences: &'a [Confluence],
}
pub fn readable(text: &str) -> String {
    let mut out = String::new();
    let mut lower = false;
    for character in text.chars() {
        if lower && character.is_ascii_uppercase() {
            out.push(' ');
        }
        if out.is_empty() {
            out.extend(character.to_uppercase());
        } else {
            out.push(character);
        }
        lower = character.is_ascii_lowercase();
    }
    out
}
impl Fields<'_> {
    pub fn label(&self, channel: &str) -> String {
        let words = vocabulary::get();
        if let Some(label) = words.ecology_labels.get(channel) {
            return label.clone();
        }
        if let Some(named) = words.names.get(channel) {
            return named.label.clone();
        }
        let parts = channel.split(':').collect::<Vec<_>>();
        if parts.len() == 1 {
            return match channel {
                "FlowAccumulation" => "River flow",
                "finalSurface" => "Land cover",
                "secondSurface" => "Land cover · second class",
                "naturalSurface" => "Natural land cover",
                "SurfaceMaterial" => "Surface material",
                _ => return readable(channel),
            }
            .into();
        }
        let name = self
            .entities
            .get(parts[1])
            .map(|e| e.name.clone())
            .or_else(|| {
                self.systems
                    .iter()
                    .find(|s| s.id == parts[1])
                    .map(|s| s.name.clone())
            })
            .unwrap_or_else(|| readable(parts[1]));
        let suffix = if parts.len() > 2 {
            readable(&parts[2..].join(" · "))
        } else {
            match parts[0] {
                "languageUse" => "Naming use".into(),
                "language" => "Knowledge".into(),
                kind => readable(kind),
            }
        };
        format!("{name} · {suffix}")
    }
    pub fn catalog(&self, channel: &str) -> LayerCatalog {
        let words = vocabulary::get();
        let name = words.names.get(channel);
        let lower = channel.to_ascii_lowercase();
        let contains = |terms: &[&str]| terms.iter().any(|term| lower.contains(term));
        let theme = if let Some(name) = name {
            &name.theme
        } else if words.ecology_labels.contains_key(channel) {
            "Biomes and life"
        } else if channel.starts_with("magic:") {
            "Magic"
        } else if contains(&[
            "temperature",
            "rain",
            "snow",
            "moisture",
            "precipitation",
            "wind",
            "runoff",
        ]) {
            "Climate"
        } else if contains(&[
            "water",
            "flow",
            "river",
            "ice",
            "sea",
            "ocean",
            "basin",
            "catchment",
        ]) {
            "Water"
        } else if contains(&[
            "surface",
            "bedrock",
            "sediment",
            "erosion",
            "landform",
            "fracture",
            "rock",
            "elevation",
        ]) {
            "Terrain"
        } else {
            "Advanced"
        };
        let mut path = vec![theme.into()];
        if let Some(name) = name {
            if !name.branch.is_empty() {
                path.push(name.branch.clone());
            }
        } else if let Some(id) = channel
            .strip_prefix("magic:")
            .and_then(|tail| tail.split(':').next())
        {
            path.push(
                self.systems
                    .iter()
                    .find(|s| s.id == id)
                    .map_or(id, |s| &s.name)
                    .into(),
            );
        }
        let common = name.is_some_and(|name| name.common)
            || channel.ends_with(":intensity")
            || [
                "Temperature",
                "Rainfall",
                "Moisture",
                "FlowAccumulation",
                "IceThickness",
                "TreeCover",
                "GrassCover",
                "WetlandCover",
                "Herbivores",
                "naturalSurface",
                "finalSurface",
                "SurfaceMaterial",
                "SedimentThickness",
            ]
            .contains(&channel);
        LayerCatalog {
            path,
            common,
            feature_types: Vec::new(),
            default_style: None,
            presets: Vec::new(),
            // hpc-exempt: entity names and published layer metadata, not numerical field storage.
            properties: BTreeMap::new(),
            examples: Vec::new(),
            geometries: Vec::new(),
        }
    }
}
pub fn display(unit: &str) -> DisplayUnit {
    let (unit, factor) = match unit {
        "native-length" => ("m", 1.0 / MapScale::NATIVE_PER_METRE),
        "per-mille" => ("%", 0.1),
        "ratio" => ("%", 100.0),
        "deci-celsius" => ("°C", 0.1),
        "square-metre" => ("km²", 1e-6),
        "people/square-kilometre" => ("people per km²", 1.0),
        "person-year/square-kilometre" => ("person-years per km²", 1.0),
        "millimetre/year" => ("mm a year", 1.0),
        "cubic-metre/second" => ("m³ a second", 1.0),
        "cubic-metre/year" => ("m³ a year", 1.0),
        "cubic-metre" => ("m³", 1.0),
        "metre/second" => ("m a second", 1.0),
        "metre" => ("m", 1.0),
        "year" => ("years", 1.0),
        "gradient" => ("rise over run", 1.0),
        "category" => ("Classes", 1.0),
        _ => (unit, 1.0),
    };
    DisplayUnit {
        unit: unit.into(),
        factor,
    }
}
