use crate::features::records::Attributes;
pub struct Descriptor<'a> {
    pub kind: &'a str,
    pub subkind: Option<&'a str>,
    pub term: Option<&'a str>,
}
pub fn descriptor<'a>(kind: &'a str, attributes: &'a Attributes) -> Option<Descriptor<'a>> {
    const BIOMES: &[&str] = &[
        "forest",
        "grassland",
        "wetland",
        "barren",
        "ember",
        "thaw",
        "rime",
        "glow",
        "fog",
        "deepwood",
        "wending",
        "well",
        "barrow",
        "pan",
        "flat",
    ];
    if BIOMES.contains(&kind) {
        if let Some(biome) = attributes.get("biome").and_then(|v| v.as_str()) {
            return Some(Descriptor {
                kind: "biome",
                subkind: Some(biome),
                term: None,
            });
        }
    }
    if let Some(value) = attributes.get("nameTerm") {
        return Some(Descriptor {
            kind: value.get("kind")?.as_str()?,
            subkind: value.get("subkind").and_then(|v| v.as_str()),
            term: value.get("term").and_then(|v| v.as_str()),
        });
    }
    if let Some(term) = landform_term(kind) {
        return Some(Descriptor {
            kind: "landform",
            subkind: Some(kind),
            term: Some(term),
        });
    }
    match kind {
        "politicalRegion" => Some(Descriptor {
            kind: "polity",
            subkind: Some("province"),
            term: Some("Province"),
        }),
        "ocean" if attributes.get("marineType").and_then(|v| v.as_str()) == Some("sea") => {
            Some(Descriptor {
                kind,
                subkind: Some("sea"),
                term: Some("Sea"),
            })
        }
        "river" | "lake" | "ocean" => Some(Descriptor {
            kind,
            subkind: None,
            term: None,
        }),
        _ => Some(Descriptor {
            kind: "magic",
            subkind: Some(attributes.get("rule")?.as_str()?),
            term: Some(attributes.get("placeType")?.as_str()?),
        }),
    }
}
fn landform_term(kind: &str) -> Option<&'static str> {
    Some(match kind {
        "peak" => "Peak",
        "cirque" => "Cirque",
        "fjord" => "Fjord",
        "moraine" => "Moraine",
        "waterfall" => "Falls",
        "range" => "Range",
        "valley" => "Valley",
        "gorge" => "Gorge",
        "crater" => "Crater",
        "volcano" => "Volcano",
        "caldera" => "Caldera",
        "fault" => "Fault",
        "dome" => "Dome",
        "escarpment" => "Escarpment",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn gis_classification_and_catalogue_terms_select_profiles() {
        let attributes = serde_json::from_value(json!({"biome":"Boreal forest"})).unwrap();
        let forest = descriptor("forest", &attributes).unwrap();
        assert_eq!(
            (forest.kind, forest.subkind),
            ("biome", Some("Boreal forest"))
        );
        let attributes = serde_json::from_value(json!({"nameTerm":{
            "kind":"societyWork", "subkind":"bridge", "term":"Crossing"
        }}))
        .unwrap();
        assert_eq!(
            descriptor("poi", &attributes).unwrap().subkind,
            Some("bridge")
        );
        assert_eq!(
            descriptor("waterfall", &Attributes::new()).unwrap().term,
            Some("Falls")
        );
        assert!(descriptor("unknown", &Attributes::new()).is_none());
    }
}
