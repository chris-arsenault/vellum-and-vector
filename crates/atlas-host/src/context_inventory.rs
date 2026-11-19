//! Host management metadata. Presentation never receives private payloads or resource handles.
use atlas_generation::GenerationStatus;
use atlas_gis::map_store::MapEntry;
use atlas_map::MapRef;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    pub maps: Vec<MapEntry>,
    pub jobs: Vec<GenerationStatus>,
    pub orphans: Vec<Orphan>,
    pub cleanup: Vec<String>,
    pub problems: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Orphan {
    pub kind: String,
    pub id: String,
    pub reference: Option<MapRef>,
    pub problem: Option<String>,
}
#[derive(Deserialize)]
#[serde(tag = "method", content = "request", rename_all = "camelCase")]
pub enum Call {
    List,
    Delete(Target),
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Target {
    Map {
        id: atlas_map::Id,
        descendants: bool,
    },
    Job {
        id: String,
    },
    Orphan {
        orphan: Orphan,
    },
    Cleanup {
        id: String,
    },
}
pub struct InputEntry {
    pub reference: Option<MapRef>,
    pub catalog: String,
    pub document: Value,
}
impl InputEntry {
    pub fn orphan(&self, maps: &[MapEntry]) -> Option<Orphan> {
        let attached = self
            .reference
            .as_ref()
            .is_some_and(|r| maps.iter().any(|m| &m.reference == r));
        (!attached).then(|| Orphan {
            kind: "inputs".into(),
            id: self.catalog.clone(),
            reference: self.reference.clone(),
            problem: crate::generation_document::FORMAT
                .read::<crate::generation_document::Document>(self.document.clone())
                .err()
                .map(|e| e.to_string()),
        })
    }
}
pub fn selected_maps(
    maps: &[MapEntry],
    id: atlas_map::Id,
    descendants: bool,
) -> BTreeSet<atlas_map::Id> {
    let mut selected = BTreeSet::from([id]);
    if descendants {
        loop {
            let children: Vec<_> = maps
                .iter()
                .filter(|m| {
                    m.parent
                        .as_ref()
                        .is_some_and(|p| selected.contains(&p.map_id))
                })
                .map(|m| m.reference.map_id)
                .collect();
            let before = selected.len();
            selected.extend(children);
            if selected.len() == before {
                break;
            }
        }
    }
    selected
}

/// File references in completed documents, captured requests, descriptors and aliases.
/// Coverage.resourceId names the logical generated surface, not a stored file. Coverage
/// describes materialization ownership; the world's fields retain its numerical bytes.
/// No numerical chunks are opened for management.
pub fn resource_references(value: &Value, into: &mut BTreeSet<String>) {
    match value {
        Value::Object(fields) => {
            for (key, value) in fields {
                if key == "coverage" {
                    continue;
                }
                if matches!(
                    key.as_str(),
                    "resourceId" | "layoutResourceId" | "treeResourceId"
                ) {
                    if let Some(id) = value.as_str() {
                        into.insert(id.into());
                    }
                } else {
                    resource_references(value, into);
                }
            }
        }
        Value::Array(values) => {
            for value in values {
                resource_references(value, into);
            }
        }
        _ => {}
    }
}
