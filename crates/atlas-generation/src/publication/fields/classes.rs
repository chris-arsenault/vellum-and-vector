use super::{vocabulary, Fields};
use atlas_map::{Category, SurfaceAppearance};
use serde::Deserialize;
// hpc-exempt: named category palettes and rule appearances, not numerical field storage.
use std::{collections::BTreeMap, sync::OnceLock};

fn category(value: &vocabulary::Category) -> Category {
    Category {
        value: value.code,
        label: value.name.clone(),
        color: Some(value.color.clone()),
        present: false,
        surface: Some(SurfaceAppearance {
            bathymetric: value.bathymetric,
            tint: value.tint,
            system: None,
            system_name: None,
        }),
    }
}
fn classed(code: i32, label: String) -> Category {
    let color = if code == 0 {
        "rgba(0,0,0,0)".into()
    } else {
        format!(
            "hsl({} {}% {}%)",
            (f64::from(code) * 137.508 % 360.0).round(),
            55 + code % 3 * 12,
            42 + code % 4 * 7
        )
    };
    category(&vocabulary::Category {
        code,
        name: label,
        color,
        bathymetric: false,
        tint: 1.0,
    })
}
impl Fields<'_> {
    pub fn categories(&self, channel: &str) -> Vec<Category> {
        let words = vocabulary::get();
        match channel {
            "PhysicalMaterial" => {
                return words
                    .physical_materials
                    .iter()
                    .enumerate()
                    .map(|(code, name)| Category {
                        value: code as i32,
                        label: name.clone(),
                        color: None,
                        present: false,
                        surface: None,
                    })
                    .collect()
            }
            "SurfaceMaterial" => return words.rock.iter().map(category).collect(),
            "BiomeCodes" => {
                return words
                    .biomes
                    .iter()
                    .enumerate()
                    .map(|(code, biome)| {
                        category(&vocabulary::Category {
                            code: code as i32,
                            name: biome.name.clone(),
                            color: biome.color.clone(),
                            bathymetric: false,
                            tint: 1.0,
                        })
                    })
                    .collect()
            }
            "naturalSurface" => return words.natural.iter().map(category).collect(),
            "finalSurface" | "secondSurface" => return self.surface_categories(),
            _ => {}
        }
        let Some(classes) = words
            .names
            .get(channel)
            .and_then(|name| name.classes.as_deref())
        else {
            return Vec::new();
        };
        if classes == "rock" {
            return words.rock.iter().map(category).collect();
        }
        let mut values = vec![classed(0, "None".into())];
        if classes == "craft" {
            values.extend(words.crafts.iter().map(|craft| {
                let system = self
                    .systems
                    .iter()
                    .find(|s| s.id == craft.system)
                    .map_or(craft.system.as_str(), |s| s.name.as_str());
                classed(craft.code, format!("{system} · {}", craft.name))
            }));
        } else {
            for entity in self.entities.values() {
                let code = &entity.attributes["traditionCode"];
                let code = code
                    .as_f64()
                    .or_else(|| code.as_str().and_then(|s| s.parse().ok()));
                if entity.attributes["traditionKind"] == classes.to_lowercase() {
                    if let Some(code) = code.filter(|&c| c >= 1.0) {
                        values.push(classed(code as i32, entity.name.clone()));
                    }
                }
            }
        }
        values
    }
    fn surface_categories(&self) -> Vec<Category> {
        let mut values = vocabulary::get()
            .natural
            .iter()
            .map(category)
            .collect::<Vec<_>>();
        let mut code = 100;
        let mut add = |system: &str, system_name: &str, rule: &str, name: &str| {
            let (color, tint) = magic_color(rule);
            values.push(Category {
                value: code,
                label: format!("{system_name} · {name}"),
                color: Some(color),
                present: false,
                surface: Some(SurfaceAppearance {
                    bathymetric: false,
                    tint,
                    system: Some(system.into()),
                    system_name: self
                        .systems
                        .iter()
                        .find(|s| s.id == system)
                        .map(|s| s.name.clone()),
                }),
            });
            code += 1;
        };
        for system in self.systems {
            for rule in &system.features {
                add(&system.id, &system.name, &rule.id, &rule.name);
            }
        }
        for rule in self.confluences {
            add("confluence", "Interactions", &rule.id, &rule.name);
        }
        values
    }
}
#[derive(Deserialize)]
struct Appearance {
    color: String,
    tint: f64,
}
fn magic_color(rule: &str) -> (String, f64) {
    // hpc-exempt: named category palettes and rule appearances, not numerical field storage.
    static VALUES: OnceLock<BTreeMap<String, Appearance>> = OnceLock::new();
    let values = VALUES.get_or_init(|| {
        serde_json::from_str(include_str!("magic-colors.json")).expect("Static magic presentation")
    });
    if let Some(value) = values.get(rule) {
        return (value.color.clone(), value.tint);
    }
    let colors = [
        "#d1495b", "#f2a541", "#2e86ab", "#8e44ad", "#1b998b", "#c9a227",
    ];
    let hash = rule.chars().fold(0u32, |hash, character| {
        let mut encoded = [0u16; 2];
        hash.wrapping_mul(31)
            .wrapping_add(u32::from(character.encode_utf16(&mut encoded)[0]))
    });
    (colors[hash as usize % colors.len()].into(), 1.0)
}
